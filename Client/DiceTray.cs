using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using OblivionMp.ChatMod;
using OblivionMp.Sdk;
using ReadyM.Cef;
using ReadyM.Cef.Rpc;
using ReadyM.SDK.Attributes;
using ReadyM.Sdk.Common.Input;

namespace RpRoll.Client;

/// <summary>
/// The dice board: a web page (web\, three.js) with the board and 1 to 5 dice (d6, d10, d20, d100) of the player's set.
/// The rolls themselves are the server's (<see cref="RpRollClientRpc"/>); the page only plays the numbers it is given.
///
/// Keys. Home (here, Polled) shows or hides the board; /board in chat does the same. While the board is open its page
/// holds the keyboard and the game is put in UI-only input (<see cref="CefHost.SetUiInputMode"/>), so Space, 1-5,
/// Tab and the arrows reach the page and not the game: the page throws on Space (<see cref="OnRpRollThrow"/>), picks
/// dice on 1-5 and asks for chat on K (<see cref="OnRpRollChat"/>). While the board is closed none of that exists and
/// the keys are the game's. While chat is open, chat's page has the keyboard, so typing never reaches the board.
///
/// Game to page: the whole state as one JSON message, sent on every change and again a few times after it, which the
/// page reconciles idempotently. Page to game: the dice pick, Space, K and Escape; the state carries back what Space
/// would throw, so the page sees and repeats a pick that got lost.
/// </summary>
[Service]
public sealed partial class DiceTray(CefHost cef, IInput input, IChat chat, RpRollClientRpc rpc, ILogger logger)
{
    private const string Host = "rproll";

    // Above chat's bar (zOrder 0): the board is full screen while it is open.
    private const int ZOrder = 5;

    // Resends after a change, in seconds. Covers a page that is still loading and messages that got lost.
    private static readonly double[] Resends = { 0.25, 0.75, 2.0, 4.0 };

    // No answer from the server after this long: the page stops waiting.
    private const double AnswerTimeoutSeconds = 5.0;

    // A throw takes up to about this long on the board; Space does nothing until it is done.
    private const double ThrowSeconds = 4.2;

    // Same limit as the server's TrayRolls.MaxDice (the server checks it again).
    private const int MaxDice = 5;

    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private IDisposable? _homeBind;
    private ViewportHandle _viewport;
    private BrowserHandle? _page;

    private bool _open;
    private bool _chatWasOpen;
    private long _nextRequestId = 1;
    private long _rollId;
    private string _rollState = "none"; // none, pending, rolled, refused
    private int[] _rollValues = Array.Empty<int>();
    private Pick _rollDice;
    private string _rollReason = string.Empty;
    private Pick _pick = Pick.Default;
    private long _pickFromServer;     // counts /roll-with-dice requests, so the page adopts each one once
    private double _rollChangedAt;
    private long _seq;
    private string _set = DefaultSet;
    private double _changedAt;
    private int _resendIndex = Resends.Length;

    public const string DefaultSet = "imperial";

    /// <summary>d6, d10, d20, d100.</summary>
    private readonly record struct Pick(int D6, int D10, int D20, int D100)
    {
        public static readonly Pick Default = new(0, 0, 1, 0);

        public int Total => D6 + D10 + D20 + D100;

        public bool Valid => D6 >= 0 && D10 >= 0 && D20 >= 0 && D100 >= 0
            && D6 <= MaxDice && D10 <= MaxDice && D20 <= MaxDice && D100 <= MaxDice && Total >= 1 && Total <= MaxDice;
    }

    /// <summary>The board is on screen. The HUD keeps quiet then: the roll is on the board.</summary>
    public bool IsOpen => _open;

    private double Now => _clock.Elapsed.TotalSeconds;

    private void Start()
    {
        string folder = Path.GetDirectoryName(typeof(DiceTray).Assembly.Location) ?? AppContext.BaseDirectory;
        cef.RegisterFolder(Host, Path.Combine(folder, "web"));
        rpc.Rolled += OnRolled;
        rpc.Refused += OnRefused;
        rpc.Toggle += OnToggleFromChat;
        rpc.Throw += OnThrowFromChat;

        // Polled: with UnhandledByUi the key never reached us in game, and Polled also fires while
        // our own page holds the keyboard, which Home needs to close it.
        _homeBind = input.RegisterKeyBind(Key.HOME, Toggle, KeySource.Polled);

        // Created hidden right away, so the page has loaded long before the first Home.
        _viewport = cef.CreateViewport(ZOrder);
        cef.SetPlacement(_viewport, ViewportPlacement.FullScreen);
        CefBrowserInstance browser = cef.CreateBrowser();
        _page = browser.Handle;
        browser.Navigate($"readym://{Host}/index.html");
        cef.Assign(_viewport, browser.Handle);
        cef.SetVisible(_viewport, false);
        Changed();
        logger.LogInformation("[RpRoll] Registered: Home (or /board) shows the dice board, Space throws on it (readym://{Host}/).", Host);
    }

    private void Stop()
    {
        rpc.Rolled -= OnRolled;
        rpc.Refused -= OnRefused;
        rpc.Toggle -= OnToggleFromChat;
        rpc.Throw -= OnThrowFromChat;
        _homeBind?.Dispose();
    }

    private void Update()
    {
        if (_rollState == "pending" && Now - _rollChangedAt > AnswerTimeoutSeconds)
        {
            SetRoll("refused", Array.Empty<int>(), "No answer from the server. Try again.");
        }
        // Chat closed while the board is open: the keyboard goes back to the board.
        bool chatOpen = chat.IsOpen;
        if (_chatWasOpen && !chatOpen && _open)
        {
            Guard("back to the board", () => cef.SetFocused(_viewport, true));
        }
        _chatWasOpen = chatOpen;
        if (_resendIndex < Resends.Length && Now - _changedAt >= Resends[_resendIndex])
        {
            _resendIndex++;
            Push();
        }
    }

    private void Toggle()
    {
        Guard("Home", () =>
        {
            if (chat.IsOpen)
            {
                return; // Home in chat's entry line belongs to chat
            }
            SetOpen(!_open);
        });
    }

    private void OnToggleFromChat()
    {
        Guard("/board", () =>
        {
            if (!_open && chat.IsOpen)
            {
                chat.Close(); // the board takes the keyboard; chat opens again with K
            }
            SetOpen(!_open);
        });
    }

    private void OnThrowFromChat(int d6, int d10, int d20, int d100)
    {
        Guard("/roll on the board", () =>
        {
            if (!_open)
            {
                return; // the server only sends this while our board is open; it may have closed since
            }
            Pick pick = new(d6, d10, d20, d100);
            if (pick.Total > 0)
            {
                if (!pick.Valid)
                {
                    return; // the server checked it already
                }
                _pick = pick;
                _pickFromServer++;
            }
            Throw();
        });
    }

    private void Throw()
    {
        bool busy = _rollState == "pending" || (_rollState == "rolled" && Now - _rollChangedAt < ThrowSeconds);
        if (busy)
        {
            return;
        }
        long id = _nextRequestId++;
        _rollId = id;
        _rollDice = _pick;
        SetRoll("pending", Array.Empty<int>(), string.Empty);
        rpc.SendRollDice(id, _pick.D6, _pick.D10, _pick.D20, _pick.D100);
        logger.LogInformation("[RpRoll] Throw #{Id}: {D6} d6, {D10} d10, {D20} d20, {D100} d100.",
            id, _pick.D6, _pick.D10, _pick.D20, _pick.D100);
    }

    private void OnRolled(long requestId, int[] values)
    {
        if (requestId != _rollId)
        {
            return;
        }
        if (values.Length != _rollDice.Total)
        {
            logger.LogError("[RpRoll] Throw #{Id}: the server sent {Count} values for {Asked} dice.", requestId, values.Length, _rollDice.Total);
            SetRoll("refused", Array.Empty<int>(), "That roll didn't work. Try again.");
            return;
        }
        SetRoll("rolled", values, string.Empty);
    }

    private void OnRefused(long requestId, string reason)
    {
        if (requestId == _rollId)
        {
            SetRoll("refused", Array.Empty<int>(), reason);
        }
    }

    private void SetOpen(bool open)
    {
        _open = open;
        cef.SetVisible(_viewport, open);
        // The page takes the keyboard while it is open, and the game gets no input at all (UI-only), so Space and
        // 1-5 neither jump nor fire a quick key. Home is Polled, so closing never depends on the page.
        cef.SetFocused(_viewport, open);
        cef.SetUiInputMode(open);
        rpc.SendBoardState(open); // so /roll from chat throws on the board while it is open
        Changed();
    }

    private void SetRoll(string state, int[] values, string reason)
    {
        _rollState = state;
        _rollValues = values;
        _rollReason = reason;
        _rollChangedAt = Now;
        Changed();
    }

    private void Changed()
    {
        _seq++;
        _changedAt = Now;
        _resendIndex = 0;
        Push();
    }

    private void Push()
    {
        if (_page is not BrowserHandle page)
        {
            return;
        }
        try
        {
            string json = JsonSerializer.Serialize(new
            {
                seq = _seq,
                open = _open,
                set = _set,
                // what Space throws now: the page's last pick that arrived, or what /roll put in the tray
                pick = new { d6 = _pick.D6, d10 = _pick.D10, d20 = _pick.D20, d100 = _pick.D100, fromServer = _pickFromServer },
                roll = new
                {
                    id = _rollId,
                    state = _rollState,
                    dice = new { d6 = _rollDice.D6, d10 = _rollDice.D10, d20 = _rollDice.D20, d100 = _rollDice.D100 },
                    values = _rollValues,
                    reason = _rollReason,
                    ageMs = (long)((Now - _rollChangedAt) * 1000),
                },
            });
            SendRpRollState(page, json);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "[RpRoll] Sending the board state to the page failed.");
        }
    }

    private void Guard(string what, Action action)
    {
        try
        {
            action();
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "[RpRoll] {What} failed.", what);
        }
    }

    // ---- game to page ----

    [SendToCef]
    public partial void SendRpRollState(BrowserHandle page, string json);

    // ---- page to game ----

    [ReceiveFromCef]
    private void OnRpRollReady(BrowserHandle page)
    {
        logger.LogInformation("[RpRoll] Dice board page loaded and talking back.");
        Push();
    }

    [ReceiveFromCef]
    private void OnRpRollSeen(BrowserHandle page, long seq)
    {
        if (seq >= _seq)
        {
            _resendIndex = Resends.Length; // the page has the latest state, no need to repeat it
        }
    }

    [ReceiveFromCef]
    private void OnRpRollSet(BrowserHandle page, string set)
    {
        // The page keeps the choice itself (localStorage). Here it is only remembered for the next state push,
        // so a reloaded page without storage gets it back; without this message it stays the default.
        if (!string.IsNullOrWhiteSpace(set) && set.Length <= 32)
        {
            _set = set;
            logger.LogInformation("[RpRoll] Dice set: {Set}", set);
        }
    }

    [ReceiveFromCef]
    private void OnRpRollDice(BrowserHandle page, int d6, int d10, int d20, int d100)
    {
        Pick pick = new(d6, d10, d20, d100);
        if (!pick.Valid)
        {
            logger.LogWarning("[RpRoll] Ignored a dice pick from the page: {D6} d6, {D10} d10, {D20} d20, {D100} d100.", d6, d10, d20, d100);
            return;
        }
        if (_pick == pick)
        {
            return;
        }
        _pick = pick;
        logger.LogInformation("[RpRoll] Dice: {D6} d6, {D10} d10, {D20} d20, {D100} d100", d6, d10, d20, d100);
        Changed(); // the page sees the pick arrived
    }

    /// <summary>Space on the open board.</summary>
    [ReceiveFromCef]
    private void OnRpRollThrow(BrowserHandle page)
    {
        Guard("Space", () =>
        {
            if (_open && !chat.IsOpen)
            {
                Throw();
            }
        });
    }

    /// <summary>K on the open board: chat takes the keyboard; when chat closes, it comes back to the board (Update).</summary>
    [ReceiveFromCef]
    private void OnRpRollChat(BrowserHandle page)
    {
        Guard("K", () =>
        {
            if (!_open || chat.IsOpen)
            {
                return;
            }
            cef.SetFocused(_viewport, false);
            chat.Open();
            _chatWasOpen = true;
        });
    }

    [ReceiveFromCef]
    private void OnRpRollClose(BrowserHandle page)
    {
        Guard("Escape", () => SetOpen(false));
    }
}
