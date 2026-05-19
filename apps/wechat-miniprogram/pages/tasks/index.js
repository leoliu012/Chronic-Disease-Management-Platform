const { request } = require('../../utils/request');
const { taskStatusLabels, labelOf, formatDateTime, statusClass } = require('../../utils/format');

Page({
  data: {
    patientId: '',
    tasks: [],
    visibleTasks: [],
    showHistory: false,
    loading: false
  },

  onShow() {
    const app = getApp();
    const patientId = app.globalData.patientId || wx.getStorageSync('patientId') || '';
    this.setData({ patientId });
    if (patientId) this.loadTasks();
  },

  onPullDownRefresh() {
    this.loadTasks().finally(() => wx.stopPullDownRefresh());
  },

  onShowHistoryChange(event) {
    this.setData({ showHistory: event.detail.value }, () => this.refreshVisibleTasks());
  },

  async loadTasks() {
    if (!this.data.patientId) return;
    this.setData({ loading: true });

    try {
      const tasks = await request({ url: `/patients/${this.data.patientId}/tasks` });
      this.setData({
        tasks: (tasks || []).map((item) => ({
          ...item,
          statusText: labelOf(taskStatusLabels, item.status),
          statusClass: statusClass(item.status),
          dueAtText: formatDateTime(item.dueAt)
        }))
      }, () => this.refreshVisibleTasks());
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  refreshVisibleTasks() {
    const visibleTasks = this.data.showHistory
      ? this.data.tasks
      : this.data.tasks.filter((item) => item.status === 'PENDING' || item.status === 'IN_PROGRESS');
    this.setData({ visibleTasks });
  },

  goBind() {
    wx.navigateTo({ url: '/pages/bind/index' });
  }
});
