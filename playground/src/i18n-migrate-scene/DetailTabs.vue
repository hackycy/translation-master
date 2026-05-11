<template>
  <ATabs v-model:activeKey="activeKey">
    <ATabPane key="1" tab="消费记录" />
    <ATabPane key="2" tab="积分明细" />
    <ATabPane key="3" :tab="dynamicTab" />
    <CustomPane panel-title="账户安全" emptyText="暂无数据" :panel-title="dynamicTitle" />
  </ATabs>
</template>

<script setup lang="ts">
const activeKey = '1'
const dynamicTab = '动态标签'
const dynamicTitle = '动态标题'
</script>
