App({
  globalData: {
    // iOS 真机如果无法访问 127.0.0.1，需要改成电脑局域网 IP，例如 http://192.168.1.20:3000
    apiBaseUrl: 'http://127.0.0.1:3000',
    patientId: '',
    patient: null
  },

  onLaunch() {
    const apiBaseUrl = wx.getStorageSync('apiBaseUrl');
    const patientId = wx.getStorageSync('patientId');
    const patient = wx.getStorageSync('patient');

    if (apiBaseUrl) {
      this.globalData.apiBaseUrl = apiBaseUrl;
    }

    if (patientId) {
      this.globalData.patientId = patientId;
    }

    if (patient) {
      this.globalData.patient = patient;
    }
  }
});
