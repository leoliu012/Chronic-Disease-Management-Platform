const { request } = require('../../utils/request');
const {
  typeLabels,
  riskLabels,
  alertStatusLabels,
  labelOf,
  formatDateTime,
  statusClass
} = require('../../utils/format');

Page({
  data: {
    patientId: '',
    activeTab: 'vitals',
    vitals: [],
    alerts: [],
    loading: false
  },

  onShow() {
    const app = getApp();
    const patientId = app.globalData.patientId || wx.getStorageSync('patientId') || '';
    this.setData({ patientId });
    if (patientId) this.loadRecords();
  },

  onPullDownRefresh() {
    this.loadRecords().finally(() => wx.stopPullDownRefresh());
  },

  switchTab(event) {
    this.setData({ activeTab: event.currentTarget.dataset.tab });
  },

  async loadRecords() {
    if (!this.data.patientId) return;
    this.setData({ loading: true });

    try {
      const [vitals, alerts] = await Promise.all([
        request({ url: `/patients/${this.data.patientId}/vital-records` }),
        request({ url: `/patients/${this.data.patientId}/risk-alerts` })
      ]);

      this.setData({
        vitals: (vitals || []).map((item) => ({
          ...item,
          typeText: labelOf(typeLabels, item.type),
          measuredAtText: formatDateTime(item.measuredAt)
        })),
        alerts: (alerts || []).map((item) => ({
          ...item,
          riskText: labelOf(riskLabels, item.riskLevel),
          statusText: labelOf(alertStatusLabels, item.status),
          statusClass: statusClass(item.status),
          createdAtText: formatDateTime(item.createdAt)
        }))
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  goBind() {
    wx.navigateTo({ url: '/pages/bind/index' });
  }
});
