<template>
  <section class="order-panel">
    <h2>订单审核</h2>
    <p>{{ owner }} 的订单需要人工审核</p>
    <button title="通过当前订单">通过</button>
    <button title="拒绝当前订单">拒绝</button>
  </section>
</template>

<script setup lang="ts">
const owner = '王五'
const tip = `共 ${2} 条待审核订单`
</script>

<style scoped>
.order-panel::after {
  content: "请及时处理";
}
</style>
