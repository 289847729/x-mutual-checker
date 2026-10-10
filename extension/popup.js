document.getElementById('openTwitterBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://x.com' });
});
