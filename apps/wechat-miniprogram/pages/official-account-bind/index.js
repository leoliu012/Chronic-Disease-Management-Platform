Page({
  data: {
    url: ''
  },

  onLoad(options) {
    const rawUrl = options && options.url;
    const url = rawUrl ? decodeURIComponent(rawUrl) : '';
    this.setData({ url });

    if (!url) {
      wx.showToast({ title: '绑定链接为空', icon: 'none' });
    }
  }
});
