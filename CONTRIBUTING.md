# Contributing

One change per commit, tests green before it lands.

## Before you push

```sh
pnpm install
pnpm test
```

`pnpm test` is offline on purpose: the host half runs against a fake host
context and a stubbed upstream, the browser half is mounted in jsdom. No key and
no network are involved.

## Signed commits

Every commit and release tag is signed with SSH — that is what produces GitHub's
**Verified** badge. The signing key is the same ed25519 key used for pushing,
registered on GitHub twice: once as an Authentication Key (push) and once as a
**Signing Key** (<https://github.com/settings/ssh/new> → Key type: Signing Key).

Signing goes through `ssh-agent`, so the passphrase-protected private key never
has to be typed again and no passphrase is stored on disk. The only requirement
is that the process running git can see the agent socket:

```sh
# Pick the running agent that actually holds a key: a host can have several
# (ssh-agent.service exports /run/user/1000/openssh_agent, a login shell may
# start its own under ~/.ssh/agent), and an empty one signs nothing.
for sock in "$SSH_AUTH_SOCK" $(find ~/.ssh/agent -type s 2>/dev/null) \
            $(systemctl --user show-environment 2>/dev/null | sed -n 's/^SSH_AUTH_SOCK=//p'); do
  [ -n "$sock" ] && [ -S "$sock" ] || continue
  if SSH_AUTH_SOCK=$sock ssh-add -l 2>/dev/null | grep -q SHA256:; then
    export SSH_AUTH_SOCK=$sock
    break
  fi
done
```

Interactive logins already have the socket. Non-interactive callers — scripts,
cron jobs, AI agents — must find it as above; pointing at an agent that holds no
key fails with `Enter passphrase for ...`, which no script can answer. An agent
is empty after a reboot, so load the key once per boot:

```sh
ssh-add ~/.ssh/id_ed25519      # one passphrase prompt, then signing is silent
```

`gpg.format=ssh`, `user.signingkey`, `commit.gpgsign` and `tag.gpgsign` are set
globally, so plain `git commit` and `git tag` sign. To re-sign existing history:

```sh
git rebase <base> --exec 'git commit --amend --no-edit -S'
git push --force-with-lease
```

To check a signature locally, keep an allowed-signers file (git refuses to
display SSH verification without one):

```sh
printf '%s %s\n' dineths728@gmail.com "$(cat ~/.ssh/id_ed25519.pub)" > ~/.ssh/allowed_signers
git config --global gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers
git log --show-signature -1
```

## Releases

Tag-driven, published from CI with provenance:

```sh
npm version patch
git push --follow-tags
```
