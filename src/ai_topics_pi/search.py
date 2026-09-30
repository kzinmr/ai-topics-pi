"""Explicit, replaceable web search integration; argv JSON avoids shell injection."""
import json
import os
import sys
import urllib.parse
import urllib.request
from .process import execute

def main():
    query=' '.join(sys.argv[1:])
    if not query:raise SystemExit('usage: wiki-search QUERY')
    if os.environ.get('WIKI_SEARCH_COMMAND'):
        argv=json.loads(os.environ['WIKI_SEARCH_COMMAND'])
        if not isinstance(argv,list) or not all(isinstance(v,str) for v in argv):raise ValueError('WIKI_SEARCH_COMMAND must be an argv array')
        print(execute(argv+[query],cwd=os.getcwd(),env=os.environ.copy(),timeout=60))
    elif os.environ.get('BRAVE_API_KEY'):
        req=urllib.request.Request('https://api.search.brave.com/res/v1/web/search?'+urllib.parse.urlencode({'q':query,'count':10}),headers={'X-Subscription-Token':os.environ['BRAVE_API_KEY'],'Accept':'application/json'})
        with urllib.request.urlopen(req,timeout=30) as res:print(res.read().decode())
    else:raise SystemExit('configure BRAVE_API_KEY or WIKI_SEARCH_COMMAND; no search provider is configured')
if __name__=='__main__':main()
