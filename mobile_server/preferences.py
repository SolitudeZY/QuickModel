"""Validated shared mobile preferences, stored with encrypted model profiles."""
from typing import Literal
from pydantic import BaseModel, Field, ConfigDict


class Preferences(BaseModel):
    model_config = ConfigDict(extra='forbid')
    theme_mode: Literal['auto','day','dusk','night'] = 'auto'
    font_size: int = Field(default=15, ge=12, le=24)
    starfield_enabled: bool = True
    starfield_mode: Literal['twinkle','trails','weather'] = 'weather'
    background_quality: Literal['eco','balanced','high'] = 'eco'
    weather_enabled: bool = True
    weather_location_mode: Literal['ip','manual'] = 'ip'
    weather_city: str = Field(default='', max_length=120)
    weather_preview: Literal['auto','clear','cloudy','rain','snow','fog','thunder'] = 'auto'
    weather_intensity: int = Field(default=70,ge=20,le=100)
    weather_mist: int = Field(default=32,ge=0,le=100)
    weather_refraction: int = Field(default=65,ge=20,le=100)
    weather_refresh_minutes: int = Field(default=30,ge=15,le=180)
    max_output_tokens: int = Field(default=4096,ge=256,le=16384)
    thinking: Literal['off','on','max'] = 'off'


class ModelEdit(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1,max_length=150)
    model: str = Field(min_length=1,max_length=200)
    system_prompt: str = Field(max_length=16000)


class SavePreferences(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int = Field(ge=0)
    active_model_config: str = Field(max_length=150)
    preferences: Preferences
    model_edit: ModelEdit | None = None


def public_settings(config):
    return {
        'revision': config.get('settings_revision',0),
        'preferences': Preferences.model_validate(config.get('mobile_preferences',{})).model_dump(),
        'active_model_config': config.get('active_model_config',''),
        'models': [{
            'name': m['name'], 'model':m.get('model',''),
            'system_prompt':m.get('system_prompt',''),
            'protocol':m.get('api_protocol') or m.get('api_type',''),
        } for m in config['model_configs']],
    }
