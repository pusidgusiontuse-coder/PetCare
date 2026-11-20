"""Shared source of truth for Premium prices in whole roubles."""
import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from login_guard import insert_if_absent
from models import SiteSetting

DEFAULT_PRICES = {'1': 99, '3': 259, '6': 499, '12': 999}
PRICE_SETTING = 'premium_prices'
RoublePrice = Annotated[int, Field(strict=True, ge=1, le=2_147_483_647)]
Period = Literal['1', '3', '6', '12']


class PremiumPrices(BaseModel):
    model_config = ConfigDict(extra='forbid')
    prices: dict[Period, RoublePrice]

    @field_validator('prices')
    @classmethod
    def require_every_period(cls, prices):
        if prices.keys() != DEFAULT_PRICES.keys():
            raise ValueError('A price is required for each Premium period')
        return {period: prices[period] for period in DEFAULT_PRICES}


def premium_prices(db):
    setting = db.get(SiteSetting, PRICE_SETTING)
    if setting is None:
        return DEFAULT_PRICES.copy()
    return PremiumPrices.model_validate_json(setting.value).prices


def set_premium_prices(db, data: PremiumPrices):
    insert_if_absent(db, SiteSetting.__table__, PRICE_SETTING, value=json.dumps(DEFAULT_PRICES))
    setting = db.get(SiteSetting, PRICE_SETTING, with_for_update=True)
    setting.value = json.dumps(data.prices)
