document.getElementById('yes').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'dialog-response', answer: 'yes' });
  window.close();
};

document.getElementById('no').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'dialog-response', answer: 'no' });
  window.close();
};
