const { request } = require('../../utils/request');

Page({
  data: {
    apiBaseUrl: 'http://127.0.0.1:3000',
    patientId: '',
    barcode: '',
    lookupResult: null,
    loading: false
  },

  onLoad() {
    const app = getApp();
    this.setData({
      apiBaseUrl: app.globalData.apiBaseUrl || wx.getStorageSync('apiBaseUrl') || 'http://127.0.0.1:3000',
      patientId: app.globalData.patientId || wx.getStorageSync('patientId') || ''
    });
  },

  onApiBaseUrlInput(event) {
    this.setData({ apiBaseUrl: event.detail.value.trim() });
  },

  onPatientIdInput(event) {
    this.setData({ patientId: event.detail.value.trim() });
  },

  onBarcodeInput(event) {
    this.setData({ barcode: event.detail.value.trim() });
  },

  saveBaseUrl() {
    const app = getApp();
    const apiBaseUrl = this.data.apiBaseUrl || 'http://127.0.0.1:3000';
    app.globalData.apiBaseUrl = apiBaseUrl;
    wx.setStorageSync('apiBaseUrl', apiBaseUrl);
  },

  persistPatient(patient) {
    const app = getApp();
    app.globalData.patientId = patient.id;
    app.globalData.patient = patient;
    wx.setStorageSync('patientId', patient.id);
    wx.setStorageSync('patient', patient);
    wx.showToast({ title: '绑定成功', icon: 'success' });
    wx.switchTab({ url: '/pages/home/index' });
  },

  async bindByPatientId() {
    if (!this.data.patientId) {
      wx.showToast({ title: '请填写患者 ID', icon: 'none' });
      return;
    }

    this.saveBaseUrl();
    this.setData({ loading: true });

    try {
      const patient = await request({ url: `/patients/${this.data.patientId}` });
      if (!patient || !patient.id) {
        wx.showToast({ title: '未找到患者', icon: 'none' });
        return;
      }
      this.persistPatient(patient);
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async lookupHis() {
    if (!this.data.barcode) {
      wx.showToast({ title: '请填写查询号码', icon: 'none' });
      return;
    }

    this.saveBaseUrl();
    this.setData({ loading: true, lookupResult: null });

    try {
      const result = await request({ url: `/his/patients/barcode/${encodeURIComponent(this.data.barcode)}` });
      this.setData({ lookupResult: result });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  confirmLookupPatient() {
    const patient = this.data.lookupResult && this.data.lookupResult.patient;
    if (!patient || !patient.id) {
      wx.showToast({ title: '该查询结果不能直接绑定', icon: 'none' });
      return;
    }
    this.persistPatient(patient);
  }
});
