document.addEventListener('DOMContentLoaded', function () {
  NProgress.start();
  console.log('started loading ai');
  console.log('done loading ai');
});

window.addEventListener('load', function () {
  NProgress.done();
});

