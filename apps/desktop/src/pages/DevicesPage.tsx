import { Laptop, Link2, QrCode, Radio, RefreshCw, ShieldCheck, Trash2, Users } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useState } from "react";

import { Badge, Button, Input, Spinner } from "@/components/ui";
import { useBackend } from "@/lib/backend-context";
import type { LanIdentity, LanOffer, LanPairResult, LanPeer, LanSyncResult } from "@/lib/types";

export function DevicesPage() {
  const backend = useBackend();
  const [identity, setIdentity] = useState<LanIdentity | null>(null);
  const [peers, setPeers] = useState<LanPeer[]>([]);
  const [offer, setOffer] = useState<LanOffer | null>(null);
  const [pairing, setPairing] = useState<LanPairResult | null>(null);
  const [sync, setSync] = useState<LanSyncResult | null>(null);
  const [incoming, setIncoming] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextIdentity, nextPeers] = await Promise.all([backend.lanIdentity(), backend.lanPeers()]);
      setIdentity(nextIdentity);
      setPeers(nextPeers);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read paired devices");
    }
  }, [backend]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const showOffer = async () => {
    setBusy(true);
    setError(null);
    try {
      setOffer(await backend.lanPairingOffer());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a pairing code");
    } finally {
      setBusy(false);
    }
  };

  const awaitPairing = async () => {
    if (!offer) return;
    setBusy(true);
    setError(null);
    setNotice("Waiting for the other device to connect…");
    try {
      const result = await backend.lanAwaitPairing(180);
      setPairing(result);
      setOffer(null);
      setNotice(`Paired with ${result.peer.name}. Compare the code with that device: ${result.sas}`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pairing did not complete");
      setNotice(null);
    } finally {
      setBusy(false);
    }
  };

  const pairWith = async (uri: string) => {
    if (!uri.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await backend.lanPair(uri.trim());
      setPairing(result);
      setIncoming("");
      setNotice(`Paired with ${result.peer.name}. Compare the code on both screens: ${result.sas}`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not pair with that device");
    } finally {
      setBusy(false);
    }
  };

  const syncWith = async (peer: LanPeer) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await backend.lanSyncPeer(peer.id);
      setSync(result);
      setNotice(
        `Synced with ${result.peerName}: ${result.merged} item${result.merged === 1 ? "" : "s"} merged, ${result.received} received, ${result.sent} sent. Code ${result.sas}.`,
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sync did not complete");
    } finally {
      setBusy(false);
    }
  };

  const acceptSync = async () => {
    setBusy(true);
    setError(null);
    setNotice("Waiting for a paired device to start syncing…");
    try {
      const result = await backend.lanAcceptSync(180);
      setSync(result);
      setNotice(
        `Synced with ${result.peerName}: ${result.merged} merged, ${result.received} received, ${result.sent} sent. Code ${result.sas}.`,
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sync did not complete");
      setNotice(null);
    } finally {
      setBusy(false);
    }
  };

  const test = async (peer: LanPeer) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await backend.lanTestPeer(peer.id);
      setPairing(result);
      setNotice(
        `Authenticated session with ${result.peer.name}. Code ${result.sas} — both devices must show the same one.`,
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach that device");
    } finally {
      setBusy(false);
    }
  };

  const toggleRevoke = async (peer: LanPeer) => {
    setBusy(true);
    try {
      await backend.lanRevokePeer(peer.id, !peer.revoked);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update that device");
    } finally {
      setBusy(false);
    }
  };

  const forget = async (peer: LanPeer) => {
    setBusy(true);
    try {
      await backend.lanForgetPeer(peer.id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove that device");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-4xl px-8 py-8">
        <header>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Trusted devices</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Pair PCs on this network. Devices verify each other once, then sync encrypted data.
          </p>
        </header>

        <section className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[12px] font-medium">This device</p>
            <p className="mt-1 font-mono text-[11.5px] text-muted-foreground">
              {identity ? identity.deviceId : "…"}
            </p>
            <p className="mt-1 font-mono text-[11.5px] text-muted-foreground">
              {identity ? identity.address : "…"}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[12px] font-medium">Pair a new device</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Show a code here and enter it on the other PC, or paste the code it shows here.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => void showOffer()}>
                <QrCode className="h-3.5 w-3.5" /> Show pairing code
              </Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void acceptSync()}>
                <Radio className="h-3.5 w-3.5" /> Accept a sync
              </Button>
            </div>
          </div>
        </section>

        {offer ? (
          <section className="mt-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start gap-5">
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={offer.uri} size={168} bgColor="#ffffff" fgColor="#111111" level="M" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium">Scan this with the other device</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                  The code expires in a few minutes and can be used once. Keep this window open while
                  the other device connects.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void awaitPairing()}>
                    <Radio className="h-3.5 w-3.5" /> Wait for connection
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setOffer(null)}>
                    Hide
                  </Button>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section className="mt-3 rounded-xl border border-border bg-surface p-4">
          <p className="text-[12.5px] font-medium">I have a pairing code</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              className="min-w-[260px] flex-1 font-mono text-[11.5px]"
              placeholder="acuye-lan://pair/…"
              value={incoming}
              spellCheck={false}
              onChange={(event) => setIncoming(event.target.value)}
            />
            <Button size="sm" disabled={busy || !incoming.trim()} onClick={() => void pairWith(incoming)}>
              <Link2 className="h-3.5 w-3.5" /> Pair
            </Button>
          </div>
        </section>

        {notice ? (
          <p className="mt-3 flex items-center gap-2 text-[12px] text-success">
            <ShieldCheck className="h-3.5 w-3.5" /> {notice}
          </p>
        ) : null}
        {error ? <p className="mt-3 text-[12px] text-danger">{error}</p> : null}
        {sync ? (
          <div className="mt-3 rounded-xl border border-border bg-surface p-3 text-[11.5px] text-muted-foreground">
            <p className="text-[12px] font-medium text-foreground">Last sync with {sync.peerName}</p>
            <p className="mt-1">
              {sync.merged} merged · {sync.received} received · {sync.sent} sent · verification code{" "}
              <span className="font-mono">{sync.sas}</span>
            </p>
            <p className="mt-1">
              Only devices paired here, signed into the same account and able to prove the same vault
              password can exchange items.
            </p>
          </div>
        ) : null}
        {pairing ? (
          <div className="mt-3 rounded-xl border border-accent/40 bg-accent/5 p-3">
            <p className="text-[12px] font-medium">Verification code</p>
            <p className="mt-1 font-mono text-[24px] tracking-[0.3em]">{pairing.sas}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Both devices must display this same code. If they differ, stop — the connection may be
              intercepted.
            </p>
          </div>
        ) : null}

        <section className="mt-6">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-[13.5px] font-semibold">Paired devices</h2>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void refresh()}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
          <div className="mt-2 space-y-2">
            {busy && peers.length === 0 ? (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Spinner /> Loading…
              </div>
            ) : peers.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center">
                <Laptop className="h-5 w-5 text-muted-foreground" />
                <p className="text-[12.5px] font-medium">No paired devices</p>
                <p className="max-w-sm text-[11.5px] leading-relaxed text-muted-foreground">
                  Pair a second PC to authenticate it directly over the local network.
                </p>
              </div>
            ) : (
              peers.map((peer) => (
                <div
                  key={peer.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[13px] font-medium">{peer.name}</p>
                      {peer.revoked ? <Badge tone="danger">Revoked</Badge> : <Badge tone="success">Trusted</Badge>}
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{peer.address}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {peer.platform} · last seen {new Date(peer.lastSeenAt * 1000).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy || peer.revoked}
                    onClick={() => void syncWith(peer)}
                  >
                    Sync
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy || peer.revoked}
                    onClick={() => void test(peer)}
                  >
                    Test
                  </Button>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void toggleRevoke(peer)}>
                    {peer.revoked ? "Restore" : "Revoke"}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void forget(peer)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
