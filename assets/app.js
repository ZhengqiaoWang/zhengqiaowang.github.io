/* 全站共用：主题切换（首屏主题由各页 <head> 里的一行内联脚本先定好，避免闪白） */
(function () {
    var root = document.documentElement;
    var btn = document.getElementById('themeBtn');
    if (!btn) return;

    btn.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        try {
            localStorage.setItem('theme', next);
        } catch (e) {
            /* 隐私模式下 localStorage 会抛错，忽略即可 */
        }
    });
})();
