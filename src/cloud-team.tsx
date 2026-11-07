import { useEffect, useRef, useState } from "react";
import type { Team } from "./types";
const api = window.companion;
export function useRoomMessages(chatId: string | undefined) {
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    if (!chatId) return;
    const id = chatId;
    let disposed = false,
      busy = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      delay = 15000,
      next = 0;
    function eligible() {
      return (
        !disposed &&
        document.visibilityState === "visible" &&
        document.hasFocus()
      );
    }
    function schedule() {
      clearTimeout(timer);
      if (eligible() && !busy)
        timer = setTimeout(check, Math.max(0, next - Date.now()));
    }
    async function check() {
      if (!eligible() || busy) return;
      busy = true;
      try {
        await api.readChat(id);
        delay = 15000;
        if (!disposed) setError("");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        delay = msg.includes("429") ? Math.min(delay * 2, 240000) : 15000;
        if (!disposed) setError("Cloud replies: " + msg);
      } finally {
        busy = false;
        next = Date.now() + delay;
        schedule();
      }
    }
    schedule();
    window.addEventListener("focus", schedule);
    window.addEventListener("blur", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("focus", schedule);
      window.removeEventListener("blur", schedule);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [chatId]);
  return error;
}
export function CloudTeam({
  id,
  model,
  close,
}: {
  id: string;
  model?: string;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [info, setInfo] = useState<Team>(),
    [error, setError] = useState(""),
    [opening, setOpening] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    let live = true;
    api
      .team(id)
      .then((data) => {
        if (live) setInfo(data);
      })
      .catch((e) => {
        if (live) setError(String(e.message));
      });
    return () => {
      live = false;
    };
  }, [id]);
  async function open() {
    setOpening(true);
    try {
      if (!info?.keys.length) await api.open("aiSetup");
      else if (!(await api.openTeam(id, model))) {
        setInfo(await api.team(id));
        return;
      }
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open ReadyCode.");
    } finally {
      setOpening(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="team-dialog"
      onCancel={close}
      aria-labelledby="team-title"
    >
      <header>
        <h2 id="team-title">Cloud Team</h2>
        <button aria-label="Close Cloud Team" onClick={close}>
          ×
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {!info && !error && <p>Loading your Cloud Team…</p>}
      {info &&
        (info.keys.length === 0 ? (
          <>
            <p>Add AI keys on readycode.ai to use several AIs together.</p>
            <button className="primary" disabled={opening} onClick={open}>
              Add AI keys ↗
            </button>
          </>
        ) : (
          <>
            <h3>
              {info.agents.length
                ? "AIs in this room"
                : "Available cloud providers"}
            </h3>
            <ul>
              {(info.agents.length
                ? info.agents.map((a) =>
                    [a.name, a.provider, a.model].filter(Boolean).join(" · "),
                  )
                : info.keys.map((k) =>
                    [k.provider, k.model].filter(Boolean).join(" · "),
                  )
              ).map((label, i) => (
                <li key={i}>{label}</li>
              ))}
            </ul>
            {info.note && <p>{info.note}</p>}
            {model && (
              <p>
                The suggested review prompt will be copied. Paste it into the
                web room and send it when you’re ready.
              </p>
            )}
            <button className="primary" disabled={opening} onClick={open}>
              {model
                ? "Copy prompt and open on readycode.ai"
                : "Open on readycode.ai"}{" "}
              ↗
            </button>
          </>
        ))}
    </dialog>
  );
}
