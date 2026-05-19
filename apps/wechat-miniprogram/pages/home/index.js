const { request } = require('../../utils/request');
const {
  riskLabels,
  taskStatusLabels,
  alertStatusLabels,
  labelOf,
  formatDateTime,
  statusClass
} = require('../../utils/format');

Page({
  data: {
    patientId: '',
    patient: {},
    patientDesc: '已绑定本院慢病档案',
    vitalCount: 0,
    abnormalVitalCount: 0,
    openAlertCount: 0,
    pendingTaskCount: 0,
    medicationCount: 0,
    uncheckedMedicationCount: 0,
    vitalPlanCount: 0,
    dueVitalPlanCount: 0,
    questionnaireDue: true,
    questionnaireCount: 0,
    todoCount: 0,
    recentAlerts: [],
    recentTasks: [],
    todayTodos: [],
    loading: false
  },

  onShow() {
    this.initAndLoad();
  },

  onPullDownRefresh() {
    this.loadDashboard().finally(() => wx.stopPullDownRefresh());
  },

  initAndLoad() {
    const app = getApp();
    const patientId = app.globalData.patientId || wx.getStorageSync('patientId') || '';
    const patient = app.globalData.patient || wx.getStorageSync('patient') || {};
    this.setData({ patientId, patient, patientDesc: this.getPatientDesc(patient) });

    if (patientId) {
      this.loadDashboard();
    }
  },

  async loadDashboard() {
    if (!this.data.patientId) return;
    this.setData({ loading: true });

    try {
      const [patient, vitals, alerts, tasks, medications, questionnaires, vitalPlans] = await Promise.all([
        request({ url: `/patients/${this.data.patientId}` }),
        request({ url: `/patients/${this.data.patientId}/vital-records` }),
        request({ url: `/patients/${this.data.patientId}/risk-alerts` }),
        request({ url: `/patients/${this.data.patientId}/tasks` }),
        request({ url: `/patients/${this.data.patientId}/medications` }),
        request({ url: `/patients/${this.data.patientId}/questionnaire-results` }),
        request({ url: `/patients/${this.data.patientId}/vital-monitoring-plans` })
      ]);

      const recentAlerts = (alerts || []).slice(0, 3).map((item) => ({
        ...item,
        riskText: labelOf(riskLabels, item.riskLevel),
        statusText: labelOf(alertStatusLabels, item.status),
        statusClass: statusClass(item.status),
        createdAtText: formatDateTime(item.createdAt)
      }));

      const recentTasks = (tasks || [])
        .filter((item) => item.status === 'PENDING' || item.status === 'IN_PROGRESS')
        .slice(0, 3)
        .map((item) => ({
          ...item,
          statusText: labelOf(taskStatusLabels, item.status),
          statusClass: statusClass(item.status),
          dueAtText: formatDateTime(item.dueAt)
        }));

      const activeMedications = (medications || []).filter((item) => item.isActive !== false);
      const dueMedicationCount = activeMedications.filter((item) => this.isMedicationDueToday(item)).length;
      const questionnaireDue = !this.hasQuestionnaireThisMonth(questionnaires || []);
      const activeVitalPlans = (vitalPlans || []).filter((item) => item.isActive !== false);
      const dueVitalPlanCount = activeVitalPlans.filter((item) => item.nextDue && (item.nextDue.canCheckIn || item.nextDue.canMarkMissed)).length;
      const todayTodos = this.buildTodayTodos(dueMedicationCount, questionnaireDue, recentTasks.length, dueVitalPlanCount);

      getApp().globalData.patient = patient;
      wx.setStorageSync('patient', patient);

      this.setData({
        patient,
        patientDesc: this.getPatientDesc(patient),
        vitalCount: (vitals || []).length,
        abnormalVitalCount: (vitals || []).filter((item) => item.isAbnormal).length,
        openAlertCount: (alerts || []).filter((item) => item.status === 'OPEN' || item.status === 'IN_PROGRESS').length,
        pendingTaskCount: (tasks || []).filter((item) => item.status === 'PENDING' || item.status === 'IN_PROGRESS').length,
        medicationCount: activeMedications.length,
        uncheckedMedicationCount: dueMedicationCount,
        questionnaireDue,
        questionnaireCount: (questionnaires || []).length,
        vitalPlanCount: activeVitalPlans.length,
        dueVitalPlanCount,
        todoCount: todayTodos.length,
        todayTodos,
        recentAlerts,
        recentTasks
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  isToday(value) {
    if (!value) return false;
    const date = new Date(value);
    const now = new Date();
    return date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();
  },


  isMedicationDueToday(item) {
    if (!item || !item.nextDose || !item.nextDose.scheduledAt) return false;
    const scheduledAt = new Date(item.nextDose.scheduledAt);
    const now = new Date();

    return scheduledAt.getFullYear() === now.getFullYear()
      && scheduledAt.getMonth() === now.getMonth()
      && scheduledAt.getDate() === now.getDate();
  },

  hasQuestionnaireThisMonth(results) {
    const now = new Date();
    return results.some((item) => {
      const date = new Date(item.createdAt);
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    });
  },

  buildTodayTodos(uncheckedMedicationCount, questionnaireDue, taskCount, dueVitalPlanCount = 0) {
    const todos = [];

    if (dueVitalPlanCount > 0) {
      todos.push({
        title: '指标打卡待完成',
        desc: `${dueVitalPlanCount} 个血压/血糖/体重等指标计划需要处理`,
        action: '去打卡',
        target: 'vitals'
      });
    }

    if (uncheckedMedicationCount > 0) {
      todos.push({
        title: '今日/下次用药待处理',
        desc: `${uncheckedMedicationCount} 个用药计划即将到达或正在等待打卡`,
        action: '去打卡',
        target: 'medications'
      });
    }

    if (questionnaireDue) {
      todos.push({
        title: '本月健康问卷待填写',
        desc: '填写后可自动进入护士端风险复核流程',
        action: '填问卷',
        target: 'questionnaire'
      });
    }

    if (taskCount > 0) {
      todos.push({
        title: '护士提醒待查看',
        desc: `${taskCount} 条异常复测/随访提醒`,
        action: '看提醒',
        target: 'tasks'
      });
    }

    if (!todos.length) {
      todos.push({
        title: '今日任务已完成',
        desc: '继续保持规律监测和用药',
        action: '查看记录',
        target: 'records'
      });
    }

    return todos;
  },

  getPatientDesc(patient) {
    return patient && patient.hospitalPatientId
      ? `院内号：${patient.hospitalPatientId}`
      : '已绑定本院慢病档案';
  },

  goBind() {
    wx.navigateTo({ url: '/pages/bind/index' });
  },

  goVitals() {
    wx.switchTab({ url: '/pages/vitals/index' });
  },

  goRecords() {
    wx.switchTab({ url: '/pages/records/index' });
  },

  goTasks() {
    wx.switchTab({ url: '/pages/tasks/index' });
  },

  goMedications() {
    wx.switchTab({ url: '/pages/medications/index' });
  },

  goQuestionnaire() {
    wx.navigateTo({ url: '/pages/questionnaire/index' });
  },

  goTodo(event) {
    const target = event.currentTarget.dataset.target;
    if (target === 'vitals') this.goVitals();
    if (target === 'medications') this.goMedications();
    if (target === 'questionnaire') this.goQuestionnaire();
    if (target === 'tasks') this.goTasks();
    if (target === 'records') this.goRecords();
  }
});


