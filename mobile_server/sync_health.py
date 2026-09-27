"""Fetch the last seven days through the existing private health service."""
import time
import httpx

with httpx.Client(base_url='http://127.0.0.1:18323', timeout=45, trust_env=False,
                  headers={'Origin':'http://127.0.0.1:18323','X-QM-Lab':'1'}) as client:
    response = client.post('/action/sync', json={})
    response.raise_for_status()
    sid = response.json().get('sync_id')
    if not sid:
        raise SystemExit('Health sync did not start; check Xiaomi account connection.')
    for _ in range(120):
        time.sleep(2)
        response = client.post('/action/progress', json={'sync_id':sid})
        response.raise_for_status()
        result = response.json()
        status = result.get('status')
        if status == 'ok':
            print('Health sync completed; added:',result.get('records_added',0),'updated:',result.get('records_updated',0))
            break
        if status in ('partial','error','cancelled'):
            raise SystemExit('Health sync status: '+status+'; manual review needed.')
    else:
        raise SystemExit('Health sync still running after four minutes.')
