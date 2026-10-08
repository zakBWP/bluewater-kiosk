// The departments and divisions editor on the Create Job / Edit Job screen.
import { app } from '../dom.js';

const commandTypeSelect = document.getElementById('commandType');
const structureSection = document.getElementById('structure');
const structureTable = document.getElementById('structure-table');
const structureRows = document.getElementById('structure-rows');
const structureEmpty = document.getElementById('structure-empty');
const addDepartmentButton = document.getElementById('add-department');
const hodCheckbox = document.getElementById('add-hod');

let structure = []; // the departments being edited: [{ id, name, divisions: [{ id, name }] }]
let shownCommandType = ''; // the command type whose departments are in the editor
let pendingFocus = null; // a department or division whose input should get focus after rendering

const HOD = 'HOD/DLCPO';
const isHod = (div) => div.name.trim().toLowerCase() === HOD.toLowerCase();

// Adds HOD/DLCPO to the end of every department that has at least one other division.
function addHod(departments) {
  for (const dept of departments) {
    if (dept.divisions.some((d) => !isHod(d)) && !dept.divisions.some(isHod)) {
      dept.divisions.push({ id: null, name: HOD });
    }
  }
}

function removeHod(departments) {
  for (const dept of departments) dept.divisions = dept.divisions.filter((d) => !isHod(d));
}

function templateFor(commandType) {
  const departments = (app.commandStructures[commandType] || []).map((dept) => ({
    id: null,
    name: dept.name,
    divisions: dept.divisions.map((name) => ({ id: null, name })),
  }));
  if (hodCheckbox.checked) addHod(departments);
  return departments;
}

function sameNames(a, b) {
  const names = (list) => JSON.stringify(list.map((d) => [d.name.trim(), d.divisions.map((v) => v.name.trim())]));
  return names(a) === names(b);
}

function nameInput(item, placeholder) {
  const input = document.createElement('input');
  input.type = 'text';
  input.required = true;
  input.placeholder = placeholder;
  input.value = item.name;
  input.addEventListener('input', () => { item.name = input.value; });
  if (item === pendingFocus) queueMicrotask(() => input.focus());
  return input;
}

function smallButton(text, label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

function renderStructure() {
  structureSection.hidden = !commandTypeSelect.value;
  structureTable.hidden = structure.length === 0;
  structureEmpty.hidden = structure.length > 0;

  structureRows.replaceChildren(...structure.map((dept) => {
    const deptCell = document.createElement('td');
    deptCell.className = 'dept';
    deptCell.append(nameInput(dept, 'Department name'));

    const divisions = document.createElement('div');
    divisions.className = 'divisions';
    for (const div of dept.divisions) {
      const chip = document.createElement('span');
      chip.className = 'division';
      chip.append(
        nameInput(div, 'Division'),
        smallButton('×', `Remove division ${div.name}`, () => {
          dept.divisions = dept.divisions.filter((v) => v !== div);
          renderStructure();
        }),
      );
      divisions.append(chip);
    }
    divisions.append(smallButton('+ Division', `Add a division to ${dept.name}`, () => {
      const div = { id: null, name: '' };
      // Keep HOD/DLCPO at the end of the list.
      const last = dept.divisions.length - 1;
      if (last >= 0 && isHod(dept.divisions[last])) dept.divisions.splice(last, 0, div);
      else dept.divisions.push(div);
      pendingFocus = div;
      renderStructure();
    }));
    const divisionsCell = document.createElement('td');
    divisionsCell.append(divisions);

    const actionsCell = document.createElement('td');
    actionsCell.className = 'row-actions';
    actionsCell.append(smallButton('Remove', `Remove department ${dept.name}`, () => {
      const count = dept.divisions.length;
      if (count > 0 && !confirm(`Remove ${dept.name || 'this department'} and its ${count} division${count === 1 ? '' : 's'}?`)) return;
      structure = structure.filter((d) => d !== dept);
      renderStructure();
    }));

    const tr = document.createElement('tr');
    tr.append(deptCell, divisionsCell, actionsCell);
    return tr;
  }));
  pendingFocus = null;
}

export function loadStructure(departments, commandType) {
  structure = departments.map((dept) => ({
    id: dept.id,
    name: dept.name,
    divisions: dept.divisions.map((div) => ({ id: div.id, name: div.name })),
  }));
  shownCommandType = commandType;
  hodCheckbox.checked = structure.some((dept) => dept.divisions.some(isHod));
  renderStructure();
}

// The departments as they should be saved.
export function getStructure() {
  return structure.map((dept) => ({
    id: dept.id,
    name: dept.name,
    divisions: dept.divisions.map((div) => ({ id: div.id, name: div.name })),
  }));
}

hodCheckbox.addEventListener('change', () => {
  if (hodCheckbox.checked) addHod(structure);
  else removeHod(structure);
  renderStructure();
});

commandTypeSelect.addEventListener('change', () => {
  const newType = commandTypeSelect.value;
  // Only ask before replacing departments the user has changed from the defaults.
  const unchanged = structure.length === 0 || sameNames(structure, templateFor(shownCommandType));
  if (!unchanged && !confirm(`Switch to the ${newType} departments and divisions? The current list will be replaced.`)) {
    commandTypeSelect.value = shownCommandType;
    return;
  }
  structure = templateFor(newType);
  shownCommandType = newType;
  renderStructure();
});

addDepartmentButton.addEventListener('click', () => {
  const dept = { id: null, name: '', divisions: [] };
  structure.push(dept);
  pendingFocus = dept;
  renderStructure();
});

// Enter in a department or division box shouldn't submit the whole form.
structureSection.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.tagName === 'INPUT') event.preventDefault();
});
