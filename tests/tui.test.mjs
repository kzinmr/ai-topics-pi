/** Exercise Pi's native TUI lifecycle through a real POSIX pseudo-terminal. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '../dist/config.js';
import { initialize } from '../dist/profile.js';
import { execute } from '../dist/process.js';
import { lockProfile } from '../dist/state.js';

test('native SDK TUI creates a new session and exits cleanly, releasing its lock',async t=>{
  const root=mkdtempSync(join(tmpdir(),'wiki-tui-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const cfg=new Config({profile:join(root,'profile')});await initialize(cfg);
  const helper=String.raw`
import errno, os, pty, select, signal, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], [sys.argv[1], sys.argv[2], '--profile', sys.argv[3], 'pi'])
output = b''
phase = 0
try:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if select.select([fd], [], [], .1)[0]:
            try:
                chunk = os.read(fd, 65536)
            except OSError as exc:
                if exc.errno == errno.EIO: break
                raise
            if not chunk: break
            output += chunk
        if phase == 0 and b'[Prompts]' in output:
            os.write(fd, b'/new\r')
            phase = 1
        if phase == 1 and b'New session started' in output:
            os.write(fd, b'\x04')
            phase = 2
    assert phase == 2, 'TUI startup/new failed: ' + repr(output[-3000:])
    while time.monotonic() < deadline:
        child, status = os.waitpid(pid, os.WNOHANG)
        if child:
            pid = 0
            assert os.waitstatus_to_exitcode(status) == 0, repr(output[-3000:])
            print('TUI clean exit')
            break
        time.sleep(.05)
    else: raise AssertionError('TUI did not exit')
finally:
    os.close(fd)
    if pid:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
`;
  const output=await execute([cfg.python(),'-c',helper,process.execPath,join(cfg.source,'dist/cli.js'),cfg.profile],{cwd:cfg.source,env:process.env,timeout:25});
  assert.match(output,/TUI clean exit/);
  lockProfile(cfg.state)();
});
