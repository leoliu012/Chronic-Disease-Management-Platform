const { patientRequest } = require('../../utils/request');
const { formatDateTime } = require('../../utils/format');

const vitalTypes = [
  { label: '血压（收缩压/舒张压）', type: 'BLOOD_PRESSURE', unit: 'mmHg', quickValues: [] },
  { label: '收缩压', type: 'SYSTOLIC_BP', unit: 'mmHg', quickValues: [120, 140, 160, 180] },
  { label: '舒张压', type: 'DIASTOLIC_BP', unit: 'mmHg', quickValues: [80, 90, 100, 110] },
  { label: '血糖', type: 'BLOOD_GLUCOSE', unit: 'mmol/L', quickValues: [5.6, 7.0, 11.1, 16.7] },
  { label: '血氧', type: 'SPO2', unit: '%', quickValues: [98, 95, 93, 89] },
  { label: '心率', type: 'HEART_RATE', unit: 'bpm', quickValues: [72, 98, 120, 48] },
  { label: '体重', type: 'WEIGHT', unit: 'kg', quickValues: [60, 70, 80, 90] }
];

Page({
  data: {
    patientId: '',
    vitalTypes,
    selectedTypeIndex: 1,
    selectedTypeLabel: vitalTypes[1].label,
    selectedPlanId: '',
    selectedPlan: null,
    plans: [],
    activePlans: [],
    unit: vitalTypes[1].unit,
    value: '',
    systolicValue: '',
    diastolicValue: '',
    note: '',
    quickValues: vitalTypes[1].quickValues.map((value) => ({ label: String(value), value })),
    submitting: false,
    loadingPlans: false,
    lastResult: null
  },

  onShow() {
    const app = getApp();
    const patientId = app.globalData.patientId || wx.getStorageSync('patientId') || '';
    this.setData({ patientId });
    if (patientId) this.loadPlans();
  },

  async loadPlans() {
    if (!this.data.patientId) return;
    this.setData({ loadingPlans: true });
    try {
      const plans = await patientRequest({ url: '/vital-monitoring-plans' });
      const activePlans = (plans || [])
        .filter((item) => item.isActive !== false)
        .map((item) => ({
          ...item,
          nextDueText: item.nextDue ? formatDateTime(item.nextDue.scheduledAt) : '待系统计算',
          reminderText: item.nextDue ? formatDateTime(item.nextDue.reminderAt) : '待系统计算',
          canCheckIn: Boolean(item.nextDue && item.nextDue.canCheckIn),
          canMarkMissed: Boolean(item.nextDue && item.nextDue.canMarkMissed)
        }));
      this.setData({ plans: plans || [], activePlans });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ loadingPlans: false });
    }
  },

  usePlan(event) {
    const planId = event.currentTarget.dataset.id;
    const plan = this.data.activePlans.find((item) => item.id === planId);
    if (!plan) return;

    const typeIndex = Math.max(0, vitalTypes.findIndex((item) => item.type === plan.vitalType));
    const selectedType = vitalTypes[typeIndex];
    this.setData({
      selectedPlanId: plan.id,
      selectedPlan: plan,
      selectedTypeIndex: typeIndex,
      selectedTypeLabel: selectedType.label,
      unit: plan.unit || selectedType.unit,
      quickValues: selectedType.quickValues.map((value) => ({ label: String(value), value })),
      value: '',
      systolicValue: '',
      diastolicValue: '',
      note: plan.nextDue ? `按计划打卡：${formatDateTime(plan.nextDue.scheduledAt)}` : ''
    });
  },

  onTypeChange(event) {
    const selectedTypeIndex = Number(event.detail.value);
    const selectedType = vitalTypes[selectedTypeIndex];
    this.setData({
      selectedTypeIndex,
      selectedTypeLabel: selectedType.label,
      selectedPlanId: '',
      selectedPlan: null,
      unit: selectedType.unit,
      value: '',
      systolicValue: '',
      diastolicValue: '',
      quickValues: selectedType.quickValues.map((value) => ({ label: String(value), value }))
    });
  },

  onValueInput(event) { this.setData({ value: event.detail.value }); },
  onSystolicInput(event) { this.setData({ systolicValue: event.detail.value }); },
  onDiastolicInput(event) { this.setData({ diastolicValue: event.detail.value }); },
  onUnitInput(event) { this.setData({ unit: event.detail.value }); },
  onNoteInput(event) { this.setData({ note: event.detail.value }); },
  useQuickValue(event) { this.setData({ value: String(event.currentTarget.dataset.value) }); },

  buildPayload(type, value) {
    const plan = this.data.selectedPlan;
    return {
      type,
      value,
      unit: this.data.unit || vitalTypes[this.data.selectedTypeIndex].unit,
      measuredAt: new Date().toISOString(),
      dataSource: 'MINI_PROGRAM',
      monitoringPlanId: this.data.selectedPlanId || undefined,
      scheduledAt: plan && plan.nextDue ? plan.nextDue.scheduledAt : undefined,
      note: this.data.note || undefined
    };
  },

  async submitVital() {
    if (!this.data.patientId) {
      wx.showToast({ title: '请先绑定患者档案', icon: 'none' });
      return;
    }

    const selectedType = vitalTypes[this.data.selectedTypeIndex];
    this.setData({ submitting: true, lastResult: null });

    try {
      let result;
      if (selectedType.type === 'BLOOD_PRESSURE') {
        const systolic = Number(this.data.systolicValue);
        const diastolic = Number(this.data.diastolicValue);
        if (!this.data.systolicValue || !this.data.diastolicValue || Number.isNaN(systolic) || Number.isNaN(diastolic)) {
          wx.showToast({ title: '请输入有效的收缩压和舒张压', icon: 'none' });
          return;
        }
        const systolicResult = await patientRequest({
          url: '/vitals',
          method: 'POST',
          data: this.buildPayload('SYSTOLIC_BP', systolic)
        });
        const diastolicResult = await patientRequest({
          url: '/vitals',
          method: 'POST',
          data: this.buildPayload('DIASTOLIC_BP', diastolic)
        });
        result = {
          vitalRecord: systolicResult.vitalRecord,
          generatedRiskAlert: systolicResult.generatedRiskAlert || diastolicResult.generatedRiskAlert,
          generatedTask: systolicResult.generatedTask || diastolicResult.generatedTask,
          pairResult: { systolicResult, diastolicResult }
        };
      } else {
        const numericValue = Number(this.data.value);
        if (!this.data.value || Number.isNaN(numericValue)) {
          wx.showToast({ title: '请输入有效数值', icon: 'none' });
          return;
        }
        result = await patientRequest({
          url: '/vitals',
          method: 'POST',
          data: this.buildPayload(selectedType.type, numericValue)
        });
      }

      this.setData({ value: '', systolicValue: '', diastolicValue: '', note: '', lastResult: result });
      await this.loadPlans();
      wx.showToast({ title: '提交成功', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async markMissed(event) {
    const planId = event.currentTarget.dataset.id;
    const plan = this.data.activePlans.find((item) => item.id === planId);
    if (!plan) return;

    try {
      await patientRequest({
        url: `/vital-monitoring-plans/${planId}/miss`,
        method: 'POST',
        data: {
          scheduledAt: plan.nextDue ? plan.nextDue.scheduledAt : undefined,
          note: '患者端反馈本次未完成指标打卡'
        }
      });
      await this.loadPlans();
      wx.showToast({ title: '已记录漏测', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    }
  },

  goBind() { wx.navigateTo({ url: '/pages/bind/index' }); }
});


