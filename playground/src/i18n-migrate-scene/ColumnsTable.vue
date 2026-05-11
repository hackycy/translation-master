<template>
  <BasicTable />
</template>

<script lang="tsx" setup>
const columns = [
  {
    title: '所属景区',
    dataIndex: 'scenicName',
  },
  {
    title: '订单类型',
    dataIndex: 'orderType',
    customRender: ({ text }: { text: number }) => <span>{text === 1 ? '团队' : '个人'}</span>,
  },
  {
    title: '审核状态',
    dataIndex: 'teamVerifyStatus',
  },
]
</script>
