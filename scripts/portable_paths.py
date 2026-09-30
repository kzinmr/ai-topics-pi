"""Paths for standalone collectors and Pi sessions."""
import os
from pathlib import Path

def profile_root():
    return Path(os.environ.get('AI_TOPICS_PROFILE') or Path.home()).expanduser()
def wiki_root():
    return profile_root() / 'wiki'
def repo_root():
    return profile_root() / 'ai-topics'
