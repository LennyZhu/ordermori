const zhHK = {
  orders: '訂單', shop: '我的店舖', newOrder: '新增訂單', saveOrder: '儲存訂單', saveChanges: '儲存修改',
  search: '搜尋買家或訂單編號', all: '全部', unpaid: '待付款', fulfillment: '待發貨', completed: '已完成',
  refunded: '已退款', cancelled: '已取消', retry: '重試', cancel: '取消', back: '返回',
  emptyTitle: '準備好開第一張單了嗎？', emptyBody: '填寫買家和商品，儲存後便可在這裡跟進收款與發貨。',
};
const en: Record<keyof typeof zhHK, string> = {
  orders: 'Orders', shop: 'My Shop', newOrder: 'New order', saveOrder: 'Save order', saveChanges: 'Save changes',
  search: 'Search buyer or order number', all: 'All', unpaid: 'Awaiting payment', fulfillment: 'To fulfil', completed: 'Completed',
  refunded: 'Refunded', cancelled: 'Cancelled', retry: 'Retry', cancel: 'Cancel', back: 'Back',
  emptyTitle: 'Ready for your first order?', emptyBody: 'Add a buyer and items, then save to track payment and fulfilment here.',
};
export const messages = { 'zh-HK': zhHK, en };
export const t = (key: keyof typeof zhHK) => messages['zh-HK'][key];
