"""Weather by the handset's public IP or an explicitly selected city, never ECS IP."""
import ipaddress
import time
import httpx

CACHE = {}


async def current_weather(preferences, client_ip):
    mode = preferences.get('weather_location_mode','ip')
    city = preferences.get('weather_city','').strip()
    if mode == 'manual' and not city:
        return {'ok':False,'reason':'请在设置中填写城市名称'}
    if mode == 'ip':
        try:
            address = ipaddress.ip_address(client_ip)
            if not address.is_global:
                return {'ok':False,'reason':'当前网络无法近似定位，请手动设置城市'}
        except ValueError:
            return {'ok':False,'reason':'无法读取手机网络地址，请手动设置城市'}
    key = (mode, city if mode == 'manual' else client_ip)
    cached = CACHE.get(key)
    if cached and time.time()-cached['at'] < preferences.get('weather_refresh_minutes',30)*60:
        return {**cached['data'],'cached':True}
    try:
        async with httpx.AsyncClient(timeout=8,trust_env=False) as client:
            if mode == 'ip':
                r = await client.get('https://ipwho.is/'+str(address))
                r.raise_for_status()
                location = r.json()
                if location.get('success') is False:
                    raise ValueError('no location')
                label = location.get('city') or location.get('region') or '当前地区'
                lat, lon = float(location['latitude']), float(location['longitude'])
            else:
                r = await client.get('https://geocoding-api.open-meteo.com/v1/search',
                                     params={'name':city,'count':1,'language':'zh','format':'json'})
                r.raise_for_status()
                places = r.json().get('results',[])
                if not places:
                    return {'ok':False,'reason':'未找到该城市，请尝试城市拼音或英文名'}
                location = places[0]
                label = location.get('name') or city
                lat,lon = float(location['latitude']),float(location['longitude'])
            if not (-90<=lat<=90 and -180<=lon<=180):
                raise ValueError('invalid location')
            r = await client.get('https://api.open-meteo.com/v1/forecast',params={
                'latitude':round(lat,2),'longitude':round(lon,2),
                'current':'temperature_2m,weather_code,cloud_cover,wind_speed_10m,precipitation,snowfall',
                'timezone':'auto'})
            r.raise_for_status()
            current = r.json()['current']
            result = {'ok':True,'weather_code':int(current['weather_code']),
                      'temperature':current.get('temperature_2m'), 'cloud_cover':current.get('cloud_cover',0),
                      'wind_speed':current.get('wind_speed_10m',0),'precipitation':current.get('precipitation',0),
                      'snowfall':current.get('snowfall',0),'location':{'name':label,'source':mode},
                      'observed_at':current.get('time'),'fetched_at':time.time(),'cached':False}
            # Short-lived in-memory cache only, not a persisted location history.
            if len(CACHE)>64: CACHE.clear()
            CACHE[key] = {'at':time.time(),'data':result}
            return result
    except (httpx.HTTPError,ValueError,KeyError,TypeError):
        if cached and time.time()-cached['at'] < 7200:
            return {**cached['data'],'stale':True}
        return {'ok':False,'reason':'定位或天气服务暂不可用，可手动指定城市或稍后重试'}
