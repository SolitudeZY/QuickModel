from datetime import datetime
from mi_fitness_mcp.models import DailyActivity, HeartRateSample, SleepSession
from mi_fitness_mcp.storage import Database


def test_repeat_and_revision(tmp_path):
    db = Database(tmp_path / 'test.db')
    common = dict(provider='mi_fitness', source_type='cloud_session', user_id='test')
    activity = DailyActivity(id='a', date='2026-09-20', steps=100, distance_m=10, active_kcal=1, **common)
    hr = HeartRateSample(id='h', timestamp=datetime(2026, 9, 20, 12), bpm=70, sample_type='passive', **common)
    sleep = SleepSession(id='s', sleep_id='sleep', start_at=datetime(2026, 9, 20), end_at=datetime(2026, 9, 20, 8),
                         duration_minutes=480, time_asleep_minutes=460, time_awake_minutes=20, **common)
    for method, record in [(db.insert_daily_activity, activity), (db.insert_heart_rate_sample, hr), (db.insert_sleep_session, sleep)]:
        assert method(record) is True
        assert method(record) is False
    activity.steps = 200
    assert db.insert_daily_activity(activity) is False
    with db._get_connection() as conn:
        assert conn.execute('SELECT steps FROM daily_activity').fetchone()[0] == 200
        for table in ['daily_activity', 'heart_rate_samples', 'sleep_sessions']:
            assert conn.execute(f'SELECT count(*) FROM {table}').fetchone()[0] == 1
