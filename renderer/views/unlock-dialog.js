// Leaving the entry form with "← Jobs" needs the kiosk password, if one is set in Settings.

const entryBack = document.getElementById('entry-back');
const unlockDialog = document.getElementById('unlock-dialog');
const unlockForm = document.getElementById('unlock-form');
const unlockPassword = document.getElementById('unlock-password');
const unlockError = document.getElementById('unlock-error');
const unlockCancel = document.getElementById('unlock-cancel');

entryBack.addEventListener('click', async (event) => {
  event.preventDefault();
  if (!(await window.api.isPasswordSet())) {
    location.hash = '#/jobs';
    return;
  }
  unlockForm.reset();
  unlockError.hidden = true;
  unlockDialog.showModal();
});

unlockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (await window.api.checkPassword(unlockPassword.value)) {
    unlockDialog.close();
    location.hash = '#/jobs';
  } else {
    unlockError.hidden = false;
    unlockPassword.select();
  }
});

unlockCancel.addEventListener('click', () => unlockDialog.close());
