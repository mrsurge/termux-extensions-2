# Opt-in broker proof: source user profiles, never edit them. As with VS Code's
# init-file integration, this imitates login startup; login_shell remains off.
if [[ -r /etc/profile ]]; then builtin source /etc/profile; fi
if [[ -r ~/.bash_profile ]]; then builtin source ~/.bash_profile
elif [[ -r ~/.bash_login ]]; then builtin source ~/.bash_login
elif [[ -r ~/.profile ]]; then builtin source ~/.profile
fi
__tc_root=${TERMINAL_DIRECTORY_ROOT:?}
__tc_nonce=${TERMINAL_DIRECTORY_NONCE:?}
unset TERMINAL_DIRECTORY_ROOT TERMINAL_DIRECTORY_NONCE
__tc_serial=0
__tc_state=busy
__tc_last=''

__tc_event() {
    local previous=$? kind=$1 token=$2 value=$3 event_id
    ((__tc_serial+=1))
    event_id=$BASHPID-$__tc_serial
    (
        umask 077
        builtin printf '%s\0%s\0%s\0%s\0' "$kind" "$token" "$value" "$PWD" > "$__tc_root/event-$event_id"
    ) && builtin printf '\033]777;te2-control;%s;%s\007' "$__tc_nonce" "$event_id"
    return "$previous"
}

__tc_apply() {
    local previous=$? source=$1 token mode requested result
    {
        IFS= read -r token && IFS= read -r mode && IFS= read -r -d '' requested
    } < "$__tc_root/request" || return "$previous"
    [[ $mode == wake || $mode == prompt ]] || return "$previous"
    [[ $token != "$__tc_last" && $token =~ ^[0-9]+-[0-9a-f]{48}$ ]] || return "$previous"
    if [[ $source == wake ]]; then
        [[ $mode == wake ]] || return "$previous"
        local actual_state
        IFS= read -r actual_state < "$__tc_root/shell-state" || return "$previous"
        if [[ $actual_state != idle ]]; then
            __tc_event result "$token" deferred
            return "$previous"
        fi
    fi
    __tc_last=$token
    if builtin cd -- "$requested"; then result=applied; else result=error; fi
    __tc_event result "$token" "$result"
    return "$previous"
}

__tc_busy() {
    local previous=$?
    __tc_set_state busy
    __tc_event state '' busy
    return "$previous"
}

__tc_set_state() {
    (
        umask 077
        builtin printf '%s\n' "$1" > "$__tc_root/state-new-$BASHPID" &&
            command mv -f -- "$__tc_root/state-new-$BASHPID" "$__tc_root/shell-state"
    )
}

__tc_before_prompt() {
    local previous=$?
    __tc_apply prompt
    return "$previous"
}

__tc_prompt() {
    local previous=$?
    __tc_set_state idle
    __tc_event state '' idle
    return "$previous"
}

# PS0 marks busy after a command is read and before it executes. The command
# substitution writes shell-owned state; existing DEBUG/preexec hooks are not
# replaced. Requires Bash 4.4+. Existing WINCH traps remain a compatibility gate.
if [[ -n $(trap -p WINCH) || ${BASH_VERSINFO[0]} -lt 4 ||
      ( ${BASH_VERSINFO[0]} -eq 4 && ${BASH_VERSINFO[1]} -lt 4 ) ]]; then
    __tc_event state '' unsupported
else
    __tc_set_state busy
    # CWD must be settled before Starship/custom prompt hooks compute PS1.
    if [[ -n ${bash_preexec_imported:-} || -n ${__bp_imported:-} ]]; then
        # bash-preexec installs its own PROMPT_COMMAND prefix lazily. Register
        # before its existing callbacks rather than preceding that install text.
        precmd_functions=(__tc_before_prompt "${precmd_functions[@]}")
    fi
    # Also cover ordinary callbacks when a profile imported bash-preexec but
    # later replaced its installer/dispatcher. Tokens prevent double application.
    PROMPT_COMMAND=(__tc_before_prompt "${PROMPT_COMMAND[@]}" __tc_prompt)
    PS0='$(__tc_busy)'"${PS0-}"
    trap '__tc_apply wake' WINCH
fi
