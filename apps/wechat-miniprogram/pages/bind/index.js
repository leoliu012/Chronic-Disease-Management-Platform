const {
  request,
  getDemoOpenId,
  persistPatientSession,
  clearPatientSession
} = require('../../utils/request');

Page({
  data: {
    apiBaseUrl: 'http://127.0.0.1:3000',
    demoOpenId: '',
    phone: '',
    hospitalPatientId: '',
    idCardLast4: '',
    bindingStatus: 'UNBOUND',
    bindingRequest: null,
    patient: null,
    message: '',
    loading: false,
    submitting: false
  },

  onLoad() {
    const app = getApp();
    this.setData({
      apiBaseUrl: app.globalData.apiBaseUrl || wx.getStorageSync('apiBaseUrl') || 'http://127.0.0.1:3000',
      demoOpenId: getDemoOpenId(),
      bindingStatus: app.globalData.bindingStatus || wx.getStorageSync('bindingStatus') || 'UNBOUND',
      patient: app.globalData.patient || wx.getStorageSync('patient') || null
    });
    this.checkBindingStatus();
  },

  onApiBaseUrlInput(event) { this.setData({ apiBaseUrl: event.detail.value.trim() }); },
  onPhoneInput(event) { this.setData({ phone: event.detail.value.trim() }); },
  onHospitalPatientIdInput(event) { this.setData({ hospitalPatientId: event.detail.value.trim() }); },
  onIdCardLast4Input(event) { this.setData({ idCardLast4: event.detail.value.trim() }); },

  saveBaseUrl() {
    const app = getApp();
    const apiBaseUrl = this.data.apiBaseUrl || 'http://127.0.0.1:3000';
    app.globalData.apiBaseUrl = apiBaseUrl;
    wx.setStorageSync('apiBaseUrl', apiBaseUrl);
  },

  async checkBindingStatus() {
    this.saveBaseUrl();
    this.setData({ loading: true, message: '' });

    try {
      const result = await request({
        url: '/patient-app/demo-login',
        method: 'POST',
        data: { demoOpenId: this.data.demoOpenId }
      });

      persistPatientSession(result);
      this.setData({
        bindingStatus: result.bindingStatus,
        bindingRequest: result.bindingRequest || null,
        patient: result.patient || null,
        message: result.message || ''
      });

      if (result.patientToken && result.patient) {
        wx.showToast({ title: '身份已确认', icon: 'success' });
        wx.switchTab({ url: '/pages/home/index' });
      }
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async submitBindingRequest() {
    const phone = this.data.phone.trim();
    const hospitalPatientId = this.data.hospitalPatientId.trim();
    const idCardLast4 = this.data.idCardLast4.trim();

    if (!phone) {
      wx.showToast({ title: '请填写手机号', icon: 'none' });
      return;
    }

    if (!hospitalPatientId && !/^\d{4}$/.test(idCardLast4)) {
      wx.showToast({ title: '请填写院内号或身份证后四位', icon: 'none' });
      return;
    }

    this.saveBaseUrl();
    this.setData({ submitting: true, message: '' });

    try {
      const result = await request({
        url: '/patient-app/binding-requests',
        method: 'POST',
        data: {
          demoOpenId: this.data.demoOpenId,
          phone,
          hospitalPatientId: hospitalPatientId || undefined,
          idCardLast4: idCardLast4 || undefined
        }
      });

      wx.setStorageSync('bindingStatus', 'PENDING');
      getApp().globalData.bindingStatus = 'PENDING';
      this.setData({
        bindingStatus: 'PENDING',
        bindingRequest: result.bindingRequest,
        patient: result.patient || null,
        message: result.message || '绑定申请已提交，请等待护士审核。'
      });
      wx.showToast({ title: '已提交审核', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  resetBinding() {
    clearPatientSession();
    this.setData({
      bindingStatus: 'UNBOUND',
      bindingRequest: null,
      patient: null,
      message: '已清除本机患者会话，可重新提交绑定申请。'
    });
  }
});
