document.getElementById('yes').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'dialog-response', answer: 'yes' });
  document.body.innerHTML = 'Connected to MCP server';
  // window.location.href = 'https://microsoft.com';
};

document.getElementById('no').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'dialog-response', answer: 'no' });
  document.body.innerHTML = 'Connection rejected';
};
