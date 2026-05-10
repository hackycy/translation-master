<template>
  <section class="order-review">
    <h2>Review Center</h2>
    <p>{{ owner }} has orders waiting for approval</p>
    <button title="Approve current order">Approve</button>
    <button title="Reject current order">Reject</button>
  </section>
</template>

<script setup lang="ts">
const owner = 'Alice'
const tip = `You have ${2} pending orders`
</script>
