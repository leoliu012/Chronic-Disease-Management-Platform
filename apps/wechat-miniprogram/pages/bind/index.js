/**
 * pages/bind/index.js —— 患者端绑定主入口
 *
 * patient-self-consent-bind 流程：
 *   首页 → 绑定/加入慢病管理 → 输入院内号 / 手机号 / 身份证后四位
 *   → 搜索院内信息 → 选择匹配结果 → 进入 consent-sign 签署知情同意书
 *   → 提交绑定申请 → 等护士审核。
 *
 * 扫码直达知情同意书的入口已移除。
 */

const {
  miniAuthRequest,
  patientRequest,
  ensureMiniSession,
  persistPatientSession,
  resetPatientIdentity
} = require('../../utils/request');

const MATCH_TYPE_LABEL = {
  CHRONIC_LEAD: '邀约库 · 高危慢病线索',
  EXISTING_PATIENT: '本院已有慢病档案',
  HIS_PATIENT: '院内系统暂存信息'
};

const RISK_LABEL = {
  LOW: '低危',
  MEDIUM: '中危',
  HIGH: '高危',
  VERY_HIGH: '极高危'
};

const DISEASE_LABEL = {
  HYPERTENSION: '高血压',
  TYPE_2_DIABETES: '2 型糖尿病',
  COPD: '慢性阻塞性肺病',
  CORONARY_HEART_DISEASE: '冠心病',
  HYPERLIPIDEMIA: '高脂血症',
  OBESITY: '肥胖症',
  OTHER: '慢病'
};

const SOURCE_LABEL = {
  HL7_DISCHARGE: '医院出院信息',
  HL7_OUTPATIENT: '门诊就诊信息',
  HL7_ABNORMAL_OBSERVATION: '化验/检验异常',
  FHIR_DISCHARGE: '出院信息（FHIR）',
  FHIR_ENCOUNTER: '门诊信息（FHIR）',
  FHIR_CONDITION: '诊断信息（FHIR）',
  FHIR_OBSERVATION: '化验信息（FHIR）',
  HIS_EVENT_DISCHARGE: '医院出院信息',
  HIS_EVENT_ENCOUNTER: '门诊信息',
  HIS_EVENT_LAB: '今日化验异常',
  INTERMEDIATE_DB: '医院前置机',
  MANUAL: '护士手工录入',
  HIS_STAGED: '院内系统暂存',
  EXISTING_PATIENT: '本院慢病档案'
};

function labelOf(map, key) {
  return (key && map[key]) || key || '';
}

// 等待护士审核期间，每隔若干秒自动复查一次绑定状态，用户无需手动刷新。
const STATUS_POLL_INTERVAL_MS = 5000;

Page({
  data: {
    phone: '',
    hospitalPatientId: '',
    idCardLast4: '',

    bindingStatus: 'UNBOUND',
    bindingRequest: null,
    patient: null,
    bound: false,
    message: '',
    officialAccountBindUrl: '',
    officialAccountBindExpiresAt: '',
    officialAccountLinkLoading: false,

    loading: false,
    searching: false,

    // 搜索结果
    lookupDone: false,
    matchType: '',
    matchTypeLabel: '',
    matchReason: '',
    snapshot: null,
    snapshotRiskLabel: '',
    snapshotDiseaseLabel: '',
    snapshotSourceLabel: '',
    chronicLeadId: '',
    matchedPatientId: '',
    alreadySigned: false,
    consentVersion: ''
  },

  async onLoad() {
    const app = getApp();
    this.setData({
      bindingStatus:
        app.globalData.bindingStatus || wx.getStorageSync('bindingStatus') || 'UNBOUND',
      patient: app.globalData.patient || wx.getStorageSync('patient') || null
    });
    try {
      await ensureMiniSession();
      this.checkBindingStatus();
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    }
  },

  onShow() {
    // 进入 / 返回本页时立即刷新一次绑定状态；checkBindingStatus 内部会根据
    // 结果决定是否开启轮询（PENDING 时轮询，其余状态停止）。
    this.checkBindingStatus({ silent: true });
  },

  onHide() {
    this.stopStatusPolling();
  },

  onUnload() {
    this.stopStatusPolling();
  },

  /**
   * 等待护士审核期间自动轮询绑定状态，无需用户手动点「刷新状态」。
   */
  startStatusPolling() {
    if (this._statusPollTimer) return;
    this._statusPollTimer = setInterval(() => {
      this.checkBindingStatus({ silent: true });
    }, STATUS_POLL_INTERVAL_MS);
  },

  stopStatusPolling() {
    if (this._statusPollTimer) {
      clearInterval(this._statusPollTimer);
      this._statusPollTimer = null;
    }
  },

  onPhoneInput(event) {
    this.setData({ phone: event.detail.value.trim() });
  },
  onHospitalPatientIdInput(event) {
    this.setData({ hospitalPatientId: event.detail.value.trim() });
  },
  onIdCardLast4Input(event) {
    this.setData({ idCardLast4: event.detail.value.trim() });
  },

  async checkBindingStatus(options) {
    const silent = options && options.silent;
    if (!silent) this.setData({ loading: true, message: '' });

    const prevStatus = this.data.bindingStatus;

    try {
      const result = await miniAuthRequest({
        url: '/patient-app/session',
        method: 'POST',
        data: {}
      });

      persistPatientSession(result);

      const bound = !!(result.patientToken && result.patient);
      this.setData({
        bindingStatus: result.bindingStatus,
        bindingRequest: result.bindingRequest || null,
        patient: result.patient || this.data.patient || null,
        bound,
        officialAccountBindUrl: bound ? this.data.officialAccountBindUrl : '',
        officialAccountBindExpiresAt: bound ? this.data.officialAccountBindExpiresAt : '',
        message: result.message || ''
      });

      // 状态变化时给出反馈（含轮询期间审核通过 / 被驳回的自动提示）。
      if (prevStatus === 'PENDING' && result.bindingStatus === 'APPROVED') {
        wx.showToast({ title: '绑定申请已通过', icon: 'success' });
      } else if (prevStatus === 'PENDING' && result.bindingStatus === 'REJECTED') {
        wx.showToast({ title: '绑定申请未通过', icon: 'none' });
      } else if (bound && !silent) {
        // 注意：此处不再自动 switchTab 回首页。否则已绑定用户从首页点「切换」
        // 进来会被立刻弹回，永远用不了下方的搜索表单（无法切换 / 绑定其他身份）。
        wx.showToast({ title: '当前身份已绑定', icon: 'none' });
      }

      // 仅在「待护士审核」时轮询；终态（已通过 / 已驳回 / 未绑定）停止轮询。
      if (result.bindingStatus === 'PENDING') {
        this.startStatusPolling();
      } else {
        this.stopStatusPolling();
      }
    } catch (error) {
      if (!silent) wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      if (!silent) this.setData({ loading: false });
    }
  },

  /**
   * 搜索院内信息：调用 identity/lookup，按 邀约库 → 已有档案 → HIS 顺序匹配。
   */
  async searchIdentity() {
    const phone = this.data.phone.trim();
    const hospitalPatientId = this.data.hospitalPatientId.trim();
    const idCardLast4 = this.data.idCardLast4.trim();

    if (!phone && !hospitalPatientId && !idCardLast4) {
      wx.showToast({ title: '请至少填写一项识别信息', icon: 'none' });
      return;
    }
    if (idCardLast4 && !/^\d{4}$/.test(idCardLast4)) {
      wx.showToast({ title: '身份证后四位需为 4 位数字', icon: 'none' });
      return;
    }
    if (phone && !/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入 11 位手机号', icon: 'none' });
      return;
    }

    this.setData({ searching: true, message: '', lookupDone: false });

    try {
      const res = await miniAuthRequest({
        url: '/patient-app/identity/lookup',
        method: 'POST',
        data: {
          phone: phone || undefined,
          hospitalPatientId: hospitalPatientId || undefined,
          idCardLast4: idCardLast4 || undefined
        }
      });

      const snapshot = res.snapshot || null;
      this.setData({
        lookupDone: true,
        matchType: res.matchType || 'NOT_FOUND',
        matchTypeLabel: labelOf(MATCH_TYPE_LABEL, res.matchType),
        matchReason: res.reason || '',
        snapshot,
        snapshotRiskLabel: snapshot ? labelOf(RISK_LABEL, snapshot.riskHint) : '',
        snapshotDiseaseLabel: snapshot
          ? labelOf(DISEASE_LABEL, snapshot.suspectedDisease) || '未指定'
          : '',
        snapshotSourceLabel: snapshot ? labelOf(SOURCE_LABEL, snapshot.sourceChannel) : '',
        chronicLeadId: (res.chronicLead && res.chronicLead.id) || '',
        matchedPatientId: (res.patient && res.patient.id) || '',
        alreadySigned: !!res.alreadySigned,
        consentVersion: res.consentVersion || ''
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ searching: false });
    }
  },

  /**
   * 确认身份 → 进入知情同意书签署页（携带识别信息，不依赖扫码参数）。
   */
  goConsentSign() {
    if (this.data.matchType === 'HIS_PATIENT') {
      wx.showModal({
        title: '需人工核验',
        content:
          '系统中暂未建立您的慢病档案，仅查到院内系统暂存信息。请联系门诊护士在院内系统核验后协助加入。',
        showCancel: false
      });
      return;
    }
    if (this.data.matchType !== 'CHRONIC_LEAD' && this.data.matchType !== 'EXISTING_PATIENT') {
      wx.showToast({ title: '未匹配到可绑定的院内信息', icon: 'none' });
      return;
    }

    // 提交绑定申请需要手机号作为联系方式，进入同意书前先确保已填写。
    if (!/^1\d{10}$/.test(this.data.phone.trim())) {
      wx.showModal({
        title: '请补充手机号',
        content: '提交绑定申请需要您本人的手机号作为联系方式，请在上方填写 11 位手机号后再继续。',
        showCancel: false
      });
      return;
    }

    const query = [
      `phone=${encodeURIComponent(this.data.phone.trim())}`,
      `hpid=${encodeURIComponent(this.data.hospitalPatientId.trim())}`,
      `id4=${encodeURIComponent(this.data.idCardLast4.trim())}`
    ].join('&');

    wx.navigateTo({
      url: `/pages/consent-sign/index?${query}`,
      fail() {
        wx.redirectTo({ url: `/pages/consent-sign/index?${query}` });
      }
    });
  },

  research() {
    this.setData({
      lookupDone: false,
      matchType: '',
      snapshot: null
    });
  },

  /**
   * 「清除本机会话」= 切换身份：不仅清会话，还轮换 demoOpenId。
   * 否则下次进入本页 / demo-login 会用同一 demoOpenId 重新命中服务端那条
   * APPROVED 绑定，把刚清掉的旧患者档案又“复活”出来。
   */
  resetBinding() {
    resetPatientIdentity();
    this.stopStatusPolling();
    this.setData({
      bindingStatus: 'UNBOUND',
      bindingRequest: null,
      patient: null,
      bound: false,
      officialAccountBindUrl: '',
      officialAccountBindExpiresAt: '',
      officialAccountLinkLoading: false,
      message: '已重置本机身份，可作为新用户重新搜索院内信息并提交绑定申请。',
      lookupDone: false,
      matchType: '',
      snapshot: null
    });
  },

  /**
   * 已绑定患者可显式返回慢病管理首页（不再自动跳转）。
   */
  goHome() {
    wx.switchTab({
      url: '/pages/home/index',
      fail() {
        wx.redirectTo({ url: '/pages/home/index' });
      }
    });
  },

  async createOfficialAccountBindUrl() {
    if (!this.data.bound) {
      wx.showToast({ title: '请先完成患者绑定审核', icon: 'none' });
      return;
    }

    this.setData({ officialAccountLinkLoading: true });
    try {
      const result = await patientRequest({
        url: '/official-account/bind-url',
        method: 'POST',
        data: {}
      });
      const url = result && result.oauthStartUrl;
      if (!url) {
        throw new Error('后端未返回公众号绑定链接');
      }

      this.setData({
        officialAccountBindUrl: url,
        officialAccountBindExpiresAt: result.expiresAt || ''
      });

      const self = this;
      wx.setClipboardData({
        data: url,
        complete() {
          self.openOfficialAccountBindUrl(url);
        }
      });
    } catch (error) {
      wx.showToast({ title: error.message || '获取公众号绑定链接失败', icon: 'none' });
    } finally {
      this.setData({ officialAccountLinkLoading: false });
    }
  },

  openOfficialAccountBindUrl(url) {
    wx.navigateTo({
      url: `/pages/official-account-bind/index?url=${encodeURIComponent(url)}`,
      fail() {
        wx.showModal({
          title: '链接已复制',
          content: '自动打开失败，请在微信里粘贴并打开已复制的链接完成服务号授权。',
          showCancel: false
        });
      }
    });
  },

  copyOfficialAccountBindUrl() {
    const url = this.data.officialAccountBindUrl;
    if (!url) {
      wx.showToast({ title: '请先生成公众号绑定链接', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: url,
      success() {
        wx.showToast({ title: '链接已复制', icon: 'success' });
      }
    });
  }
});
