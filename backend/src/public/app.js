const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const clock = $('[data-clock]');
if (clock) {
  const updateClock = () => {
    clock.textContent = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Phnom_Penh',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(new Date()) + ' ICT';
  };
  updateClock();
  setInterval(updateClock, 1000);
}

$('[data-menu]')?.addEventListener('click', () => $('#sidebar')?.classList.toggle('open'));

function toast(message, error = false) {
  const element = $('[data-toast]');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error', error);
  element.hidden = false;
  clearTimeout(window.ecolumeToast);
  window.ecolumeToast = setTimeout(() => { element.hidden = true; }, 4200);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

const commandForm = $('[data-command-form]');
if (commandForm) {
  const range = $('input[type=range]', commandForm);
  const output = $('[data-brightness]', commandForm);
  range?.addEventListener('input', () => { output.textContent = `${range.value}%`; });

  commandForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('button[type=submit]', commandForm);
    button.disabled = true;
    try {
      const body = {
        action: 'set',
        on: $('input[name=on]', commandForm).checked,
        brightness: Number(range.value)
      };
      const result = await api(`/api/v1/lights/${commandForm.dataset.lightId}/commands`, {
        method: 'POST', body: JSON.stringify(body)
      });
      toast(result.published ? 'Command published. Waiting for device acknowledgement.' : 'Command queued until the broker is available.');
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $$('[data-command]', commandForm).forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await api(`/api/v1/lights/${commandForm.dataset.lightId}/commands`, {
        method: 'POST', body: JSON.stringify({ action: button.dataset.command })
      });
      toast('Command accepted.');
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  }));
}

$$('[data-ack-alert]').forEach((button) => button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    await api(`/api/v1/alerts/${button.dataset.ackAlert}/acknowledge`, {
      method: 'POST', body: '{}'
    });
    button.closest('tr').querySelector('td:nth-child(5)').textContent = 'ACKNOWLEDGED';
    button.replaceWith('—');
    toast('Alert acknowledged and recorded in the audit trail.');
  } catch (error) {
    button.disabled = false;
    toast(error.message, true);
  }
}));

const provisionForm = $('[data-provision-form]');
provisionForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('button[type=submit]', provisionForm);
  const data = Object.fromEntries(new FormData(provisionForm).entries());
  button.disabled = true;
  try {
    const result = await api('/api/v1/lights', {
      method: 'POST',
      body: JSON.stringify({
        ...data,
        nominalWatts: Number(data.nominalWatts),
        latitude: Number(data.latitude),
        longitude: Number(data.longitude)
      })
    });
    window.prompt(
      `Asset ${result.asset_code} was created. Copy this one-time device token now:`,
      result.deviceToken
    );
    window.location.reload();
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
  }
});

$$('[data-work-order]').forEach((button) => button.addEventListener('click', async () => {
  const assignedTo = window.prompt('Assign to technician/team (optional):', '') ?? '';
  button.disabled = true;
  try {
    const result = await api('/api/v1/work-orders', {
      method: 'POST',
      body: JSON.stringify({
        lightId: button.dataset.lightId,
        alertId: button.dataset.alertId,
        title: `Investigate ${button.dataset.alertType.replaceAll('_', ' ').toLowerCase()}`,
        description: 'Created from the EcoLume alert queue.',
        priority: button.dataset.severity === 'CRITICAL' ? 'EMERGENCY' : 'HIGH',
        assignedTo: assignedTo || undefined
      })
    });
    button.replaceWith(result.reference_no);
    toast(`Work order ${result.reference_no} created.`);
  } catch (error) {
    button.disabled = false;
    toast(error.message, true);
  }
}));
