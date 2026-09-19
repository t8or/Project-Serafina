"""Lightweight, explicit extraction settings; no ML libraries imported by readiness checks."""
import importlib.util
import os
import sys

def resolve_ocr_engine(requested=None, platform_name=None):
    requested=requested or os.environ.get('SERAFINA_OCR_ENGINE','easyocr')
    platform_name=platform_name or sys.platform
    if requested not in ('easyocr','ocrmac','auto'):
        raise ValueError('SERAFINA_OCR_ENGINE must be easyocr, ocrmac, or auto')
    if requested=='auto':
        return 'ocrmac' if platform_name=='darwin' and importlib.util.find_spec('ocrmac') else 'easyocr'
    if requested=='ocrmac' and platform_name!='darwin':
        raise ValueError('ocrmac requires macOS; select easyocr on this platform')
    if importlib.util.find_spec(requested) is None:
        raise ValueError(f'OCR package {requested} is not installed in the configured Python environment')
    return requested
