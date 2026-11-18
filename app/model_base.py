"""Shared ORM metadata; importing models does not load web credentials."""
from sqlalchemy.orm import declarative_base

Base = declarative_base()
