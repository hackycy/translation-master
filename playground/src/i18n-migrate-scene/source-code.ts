export interface PaymentRecord {
  id: string
  amount?: number
  owner: string
  status: 'pending' | 'paid'
}

export const securityTitle = '账号安全'

export const columns = [
  {
    title: '用户姓名',
    dataIndex: 'realname',
    width: 100,
  },
  {
    title: '状态',
    dataIndex: 'status',
    customRender: ({ text }: { text: PaymentRecord['status'] }) => {
      return text === 'paid' ? '已支付' : '待支付'
    },
  },
]

export const uploadTips = {
  defaultText: '上传',
  sizeWarning: '图片大小不能超过 2MB!',
  placeholder: '请使用扫码枪扫描客户微信/支付宝付款码',
}

export function getPaymentTitle(record: PaymentRecord): string {
  return `订单支付 ${record.amount ? ` - ¥${record.amount}` : ''}`
}

export function getReviewTip(count: number): string {
  return `共 ${count} 条待审核订单`
}

export function getSafeDynamicUrl(config: { getData: string }, props: { code: string }): string {
  return `${config.getData}${props.code}`
}

// const commented = '不要翻译注释里的字符串'
