<template>
  <div v-if="showTips" class="image-upload-tips">
    <template v-if="width && height">建议尺寸：{{ width }} × {{ height }} px，</template>
    图片大小不超过 {{ fileMaxSize }}MB
    <template v-if="fileMax > 1">，最大上传{{ fileMax }}张图片</template>
  </div>
</template>

<script setup lang="ts">
const showTips = true
const width = 320
const height = 180
const fileMaxSize = 2
const fileMax = 3
</script>
