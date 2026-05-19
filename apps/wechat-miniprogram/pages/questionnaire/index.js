const { patientRequest } = require('../../utils/request');
const { riskLabels, labelOf, formatDateTime, statusClass } = require('../../utils/format');

const questionnaireTypes = [
  { label: '高血压月度随访问卷', value: 'HYPERTENSION_MONTHLY' },
  { label: '糖尿病月度随访问卷', value: 'DIABETES_MONTHLY' },
  { label: '慢阻肺症状问卷', value: 'COPD_SYMPTOM' },
  { label: '多病共管综合问卷', value: 'MULTI_DISEASE_MONTHLY' }
];

Page({
  data: {
    patientId: '',
    questionnaireTypes,
    selectedTypeIndex: 0,
    selectedTypeLabel: questionnaireTypes[0].label,
    score: 0,
    dizziness: false,
    chestTightness: false,
    hypoglycemia: false,
    medicationIrregular: false,
    missedFollowUp: false,
    note: '',
    results: [],
    submitting: false,
    loading: false,
    lastResult: null
  },

  onShow() {
    const app = getApp();
    const patientId = app.globalData.patientId || wx.getStorageSync('patientId') || '';
    this.setData({ patientId });

    if (patientId) {
      this.loadResults();
    }
  },

  onPullDownRefresh() {
    this.loadResults().finally(() => wx.stopPullDownRefresh());
  },

  async loadResults() {
    if (!this.data.patientId) return;
    this.setData({ loading: true });

    try {
      const results = await patientRequest({ url: '/questionnaire-results' });
      this.setData({
        results: (results || []).map((item) => ({
          ...item,
          typeText: this.getQuestionnaireTypeLabel(item.questionnaireType),
          riskText: labelOf(riskLabels, item.riskLevel),
          statusClass: statusClass(item.riskLevel === 'LOW' ? 'RESOLVED' : 'OPEN'),
          createdAtText: formatDateTime(item.createdAt)
        }))
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  getQuestionnaireTypeLabel(value) {
    const match = questionnaireTypes.find((item) => item.value === value || item.label === value);
    return match ? match.label : value;
  },

  onTypeChange(event) {
    const selectedTypeIndex = Number(event.detail.value);
    this.setData({
      selectedTypeIndex,
      selectedTypeLabel: questionnaireTypes[selectedTypeIndex].label
    });
  },

  onScoreChange(event) {
    this.setData({ score: Number(event.detail.value) });
  },

  onDizzinessChange(event) {
    this.setData({ dizziness: event.detail.value });
  },

  onChestTightnessChange(event) {
    this.setData({ chestTightness: event.detail.value });
  },

  onHypoglycemiaChange(event) {
    this.setData({ hypoglycemia: event.detail.value });
  },

  onMedicationIrregularChange(event) {
    this.setData({ medicationIrregular: event.detail.value });
  },

  onMissedFollowUpChange(event) {
    this.setData({ missedFollowUp: event.detail.value });
  },

  onNoteInput(event) {
    this.setData({ note: event.detail.value });
  },

  async submitQuestionnaire() {
    if (!this.data.patientId) {
      wx.showToast({ title: '请先绑定患者档案', icon: 'none' });
      return;
    }

    const selectedType = questionnaireTypes[this.data.selectedTypeIndex];
    this.setData({ submitting: true, lastResult: null });

    try {
      const result = await patientRequest({
        url: '/questionnaire-results',
        method: 'POST',
        data: {
          questionnaireType: selectedType.label,
          score: Number(this.data.score),
          dataSource: 'MINI_PROGRAM',
          note: this.data.note || undefined,
          answers: {
            questionnaireCode: selectedType.value,
            dizziness: this.data.dizziness,
            chestTightness: this.data.chestTightness,
            hypoglycemia: this.data.hypoglycemia,
            medicationIrregular: this.data.medicationIrregular,
            missedFollowUp: this.data.missedFollowUp
          }
        }
      });

      this.setData({
        lastResult: result,
        score: 0,
        dizziness: false,
        chestTightness: false,
        hypoglycemia: false,
        medicationIrregular: false,
        missedFollowUp: false,
        note: ''
      });
      wx.showToast({ title: '问卷已提交', icon: 'success' });
      await this.loadResults();
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  goBind() {
    wx.navigateTo({ url: '/pages/bind/index' });
  }
});


