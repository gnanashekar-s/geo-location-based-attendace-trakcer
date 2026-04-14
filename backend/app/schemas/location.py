"""
Pydantic schemas for geofence sites and location checks.
"""

from __future__ import annotations

from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class SiteCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    address: Optional[str] = Field(None, min_length=1, max_length=500)
    center_lat: float = Field(..., ge=-90.0, le=90.0)
    center_lng: float = Field(..., ge=-180.0, le=180.0)
    radius_meters: float = Field(..., gt=0.0, le=50_000.0)
    polygon: Optional[Dict[str, Any]] = None  # GeoJSON Polygon / MultiPolygon
    org_id: Optional[UUID] = None  # Required only for super_admin cross-org creation

    @field_validator("polygon", mode="before")
    @classmethod
    def validate_geojson_polygon(cls, v: Any) -> Any:
        if v is None:
            return v
        if not isinstance(v, dict):
            raise ValueError("polygon must be a GeoJSON dict")
        geojson_type = v.get("type")
        if geojson_type not in ("Polygon", "MultiPolygon"):
            raise ValueError("polygon GeoJSON type must be 'Polygon' or 'MultiPolygon'")
        if "coordinates" not in v:
            raise ValueError("polygon GeoJSON must contain 'coordinates'")
        return v

    model_config = {
        "json_schema_extra": {
            "example": {
                "name": "HQ Office",
                "address": "123 Main St, Lagos, Nigeria",
                "center_lat": 6.5244,
                "center_lng": 3.3792,
                "radius_meters": 150,
                "polygon": None,
            }
        }
    }


class SiteUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    address: Optional[str] = Field(None, min_length=1, max_length=500)
    center_lat: Optional[float] = Field(None, ge=-90.0, le=90.0)
    center_lng: Optional[float] = Field(None, ge=-180.0, le=180.0)
    radius_meters: Optional[float] = Field(None, gt=0.0, le=50_000.0)
    polygon: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None

    @field_validator("polygon", mode="before")
    @classmethod
    def validate_geojson_polygon(cls, v: Any) -> Any:
        if v is None:
            return v
        if not isinstance(v, dict):
            raise ValueError("polygon must be a GeoJSON dict")
        geojson_type = v.get("type")
        if geojson_type not in ("Polygon", "MultiPolygon"):
            raise ValueError("polygon GeoJSON type must be 'Polygon' or 'MultiPolygon'")
        if "coordinates" not in v:
            raise ValueError("polygon GeoJSON must contain 'coordinates'")
        return v


class SiteResponse(BaseModel):
    id: UUID
    org_id: UUID
    name: str
    address: Optional[str] = None
    center_lat: float
    center_lng: float
    radius_meters: float
    polygon: Optional[Dict[str, Any]] = None
    is_active: bool
    created_by: Optional[UUID] = None
    created_at: Optional[Any] = None
    updated_at: Optional[Any] = None

    model_config = {"from_attributes": True}


class GeofenceCheck(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lng: float = Field(..., ge=-180.0, le=180.0)
    site_id: UUID

    model_config = {
        "json_schema_extra": {
            "example": {
                "lat": 6.5244,
                "lng": 3.3792,
                "site_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
            }
        }
    }
