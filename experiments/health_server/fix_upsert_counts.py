"""Patch only the three experimental data types; fail on unexpected upstream."""
from pathlib import Path

path = Path('/opt/quickmodel-health-source/src/mi_fitness_mcp/storage/__init__.py')
text = path.read_text()
specs = [
    ('insert_daily_activity', 'daily_activity', 'id = ?', '(activity.id,)'),
    ('insert_heart_rate_sample', 'heart_rate_samples', 'id = ?', '(sample.id,)'),
    ('insert_sleep_session', 'sleep_sessions', 'user_id = ? AND sleep_id = ?', '(sleep.user_id, sleep.sleep_id)'),
]
for method, table, where, args in specs:
    start = text.index('    def ' + method + '(')
    end = text.find('\n    def ', start + 5)
    if end == -1:
        end = len(text)
    block = text[start:end]
    if 'return not existed' in block:
        continue
    assert block.count('return cursor.rowcount > 0') == 1
    marker = '        with self._get_connection() as conn:\n'
    assert block.count(marker) == 1
    block = block.replace(marker, marker +
        '            conn.execute("BEGIN IMMEDIATE")\n' +
        f'            existed = conn.execute("SELECT 1 FROM {table} WHERE {where}", {args}).fetchone() is not None\n')
    block = block.replace('return cursor.rowcount > 0', 'return not existed')
    text = text[:start] + block + text[end:]
path.write_text(text)
