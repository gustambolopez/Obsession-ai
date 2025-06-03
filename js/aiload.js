document.addEventListener('DOMContentLoaded', function () {
  NProgress.start();
  console.log('start');
  console.log('done');
});

window.addEventListener('load', function () {
  NProgress.done();
});

