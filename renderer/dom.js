// Helpers and state shared by every screen.

const views = {
  list: document.getElementById('view-list'),
  form: document.getElementById('view-form'),
  entry: document.getElementById('view-entry'),
  settings: document.getElementById('view-settings'),
};

// Filled once at start-up from window.api.getInfo().
export const app = {
  currentYear: null,
  commandStructures: {}, // default departments and divisions per command type
};

export function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  window.scrollTo(0, 0);
}

export function isShown(name) {
  return !views[name].hidden;
}

export function linkButton(text, href, className = 'button') {
  const a = document.createElement('a');
  a.className = className;
  a.href = href;
  a.textContent = text;
  return a;
}

// Selected by default, so resetting the form goes back to it rather than the first real option.
export function placeholderOption(text) {
  const option = new Option(text, '', true, true);
  option.disabled = true;
  return option;
}
