const { patientRequest } = require('../../utils/request');
const { formatDateTime } = require('../../utils/format');

const timingRelationLabels = {
  NONE: '不限定',
  BEFORE_MEAL: '饭前',
  AFTER_MEAL: '饭后',
  WITH_MEAL: '随餐'
};

const frequencyUnitLabels = {
  DAY: '日',
  WEEK: '周',
  MONTH: '月'
};

Page({
  data: {
    patientId: '',
    medications: [],
    checkIns: [],
    loading: false,
    submitting: false,
    lastResult: null
  },

  onShow() {
    const app = getApp();
    const patientId = app.globalData.patientId || wx.getStorageSync('patientId') || '';
    this.setData({ patientId });

    if (patientId) {
      this.loadData();
    }
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
  },

  async loadData() {
    if (!this.data.patientId) return;
    this.setData({ loading: true });

    try {
      const [medications, checkIns] = await Promise.all([
        patientRequest({ url: '/medications' }),
        patientRequest({ url: '/medication-check-ins' })
      ]);

      this.setData({
        medications: (medications || [])
          .filter((item) => item.isActive !== false)
          .map((item) => this.formatMedication(item)),
        checkIns: (checkIns || []).slice(0, 10).map((item) => ({
          ...item,
          checkedAtText: formatDateTime(item.checkedAt),
          scheduledAtText: item.scheduledAt ? formatDateTime(item.scheduledAt) : '',
          medicationName: item.medication ? item.medication.medicationName : '未知药品',
          takenText: item.taken ? '已服药' : '漏服/未服'
        }))
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  formatMedication(item) {
    const summary = item.adherenceSummary || {};
    const nextDose = item.nextDose || null;
    const schedule = item.schedule || {};
    const adherenceText = summary.adherenceRate === null || summary.adherenceRate === undefined
      ? '暂无打卡'
      : `${summary.adherenceRate}%`;
    const scheduleText = `每${frequencyUnitLabels[schedule.frequencyUnit] || '日'} ${schedule.timesPerUnit || item.timesPerUnit || 1} 次 · ${timingRelationLabels[schedule.timingRelation] || '不限定'}`;

    let actionHint = '等待后端计算下次用药时间';
    if (nextDose) {
      if (nextDose.canReportMissed) {
        actionHint = '已超过用药时间 3 小时，可反馈漏服/未服';
      } else if (nextDose.canCheckIn) {
        actionHint = '已进入用药前 3 小时窗口，可打卡';
      } else {
        actionHint = `将在 ${formatDateTime(nextDose.checkInAvailableAt)} 开放打卡`;
      }
    }

    return {
      ...item,
      nextDose,
      nextDoseScheduledAt: nextDose ? nextDose.scheduledAt : '',
      nextDoseText: nextDose ? formatDateTime(nextDose.scheduledAt) : '暂无下一次用药',
      reminderAtText: nextDose ? formatDateTime(nextDose.reminderAt) : '未生成',
      canCheckIn: !!(nextDose && nextDose.canCheckIn),
      canReportMissed: !!(nextDose && nextDose.canReportMissed),
      actionHint,
      scheduleText,
      lastCheckInAtText: item.lastCheckInAt ? formatDateTime(item.lastCheckInAt) : '暂无打卡',
      adherenceText,
      recentMissedCount: summary.recentMissedCount || 0
    };
  },

  async checkInTaken(event) {
    const { id, scheduledAt } = event.currentTarget.dataset;
    await this.createCheckIn(id, scheduledAt, true);
  },

  async checkInMissed(event) {
    const { id, scheduledAt } = event.currentTarget.dataset;
    await this.createCheckIn(id, scheduledAt, false);
  },

  async createCheckIn(medicationId, scheduledAt, taken) {
    if (!medicationId) return;
    this.setData({ submitting: true, lastResult: null });

    try {
      const result = await patientRequest({
        url: `/medications/${medicationId}/check-ins`,
        method: 'POST',
        data: {
          taken,
          checkedAt: new Date().toISOString(),
          scheduledAt,
          note: taken ? '患者微信小程序确认已服药' : '患者微信小程序反馈漏服/未服药'
        }
      });

      this.setData({ lastResult: result });
      wx.showToast({ title: taken ? '已完成打卡' : '已提交漏服提醒', icon: 'success' });
      await this.loadData();
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  goBind() {
    wx.navigateTo({ url: '/pages/bind/index' });
  },

  goQuestionnaire() {
    wx.navigateTo({ url: '/pages/questionnaire/index' });
  }
});


