"""Collect recent durable checkpoints for nightly synthesis without network I/O."""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path


def collect():
    state = Path(os.environ.get('AI_TOPICS_STATE', Path.home()/'.ai-topics'))
    cutoff = datetime.now(timezone.utc)-timedelta(days=7)
    articles = {}
    for source, folder, pattern in (
        ('blog', 'blog_ingest', 'blog_ingest_*.json'),
        ('newsletter', 'newsletter', 'newsletter_*.json'),
    ):
        for path in sorted((state/'data'/folder).glob(pattern), reverse=True):
            payload = json.loads(path.read_text())
            stamp = payload.get('collected_at')
            if not stamp or datetime.fromisoformat(stamp.replace('Z', '+00:00')) < cutoff:
                continue
            if source == 'blog':
                candidates = payload.get('saved_articles', [])
            else:
                candidates = [{**article, 'raw_path': msg.get('raw_path')}
                              for msg in payload.get('processed_messages', [])
                              for article in msg.get('articles', [])]
            for article in candidates:
                url = article.get('url')
                if url and url not in articles:
                    articles[url] = {**article, 'source': source}
    limit = int(os.environ.get('AI_TOPICS_DREAMING_LIMIT', '100'))
    if limit <= 0:
        raise ValueError('AI_TOPICS_DREAMING_LIMIT must be positive')
    values = list(articles.values())
    return {'total_articles': min(len(values), limit), 'collected_articles': len(values),
            'truncated': len(values) > limit, 'articles': values[:limit]}


if __name__ == '__main__':
    print(json.dumps(collect(), ensure_ascii=False))
