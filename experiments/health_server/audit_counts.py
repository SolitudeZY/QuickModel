"""Output aggregate integrity only; never print health values or account IDs."""
import json
import sqlite3

with sqlite3.connect('file:/var/lib/quickmodel-health/health.db?mode=ro', uri=True) as db:
    result = {}
    for table, keys in [('daily_activity', 'id'), ('heart_rate_samples', 'user_id,timestamp,sample_type'),
                        ('sleep_sessions', 'user_id,sleep_id')]:
        count = db.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
        unique = db.execute(f'SELECT count(*) FROM (SELECT {keys} FROM {table} GROUP BY {keys})').fetchone()[0]
        result[table] = {'rows': count, 'duplicate_business_keys': count - unique}
    result['plaintext_pass_tokens'] = db.execute("SELECT count(*) FROM api_keys WHERE pass_token != ''").fetchone()[0]
    print(json.dumps(result))
