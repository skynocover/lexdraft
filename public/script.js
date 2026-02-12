const result = document.getElementById('result')

async function callApi(path) {
  try {
    const res = await fetch(path)
    const data = await res.json()
    result.textContent = JSON.stringify(data, null, 2)
  } catch (err) {
    result.textContent = 'Error: ' + err.message
  }
}

document.getElementById('btn-hello').addEventListener('click', () => callApi('/api/hello'))
document.getElementById('btn-time').addEventListener('click', () => callApi('/api/time'))
