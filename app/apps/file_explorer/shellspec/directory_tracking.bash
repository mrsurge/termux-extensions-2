# File Explorer-owned startup integration. Paths are never evaluated as code.
# Like Code Server, --init-file imitates login profile loading; login_shell is off.
if [[ -r /etc/profile ]]; then builtin source /etc/profile; fi
if [[ -r ~/.bash_profile ]]; then builtin source ~/.bash_profile
elif [[ -r ~/.bash_login ]]; then builtin source ~/.bash_login
elif [[ -r ~/.profile ]]; then builtin source ~/.profile
fi

# Private to this shell generation; don't propagate integration into child shells.
__te2_directory_root=${TE2_DIRECTORY_TRACKING_ROOT:-}
unset TE2_DIRECTORY_TRACKING_ROOT
__te2_directory_last=-1

__te2_directory_prompt() {
    local previous=$? revision enabled requested result=ready
    if [[ -z $__te2_directory_root ]]; then return "$previous"; fi
    {
        IFS= read -r revision && IFS= read -r enabled && IFS= read -r -d '' requested
    } < "$__te2_directory_root/request" || return "$previous"
    [[ $revision =~ ^[0-9]+-[0-9a-f]{32}$ && ( $enabled == 0 || $enabled == 1 ) ]] || return "$previous"
    [[ $revision != "$__te2_directory_last" ]] || return "$previous"
    __te2_directory_last=$revision
    if [[ $enabled == 1 ]]; then
        if builtin cd -- "$requested"; then result=applied; else result=error; fi
    fi
    # umask is scoped to the acknowledgment writer, not the user's shell.
    (
        umask 077
        builtin printf '%s\n%s\n%s\0' "$revision" "$result" "$PWD" > "$__te2_directory_root/.ack-$$" &&
            command mv -f -- "$__te2_directory_root/.ack-$$" "$__te2_directory_root/ack"
    ) && builtin printf '\033]777;te2-directory;%s\007' "$revision"
    return "$previous"
}

# Array conversion preserves both scalar command strings and existing arrays.
# Return the previous command's status before user prompt callbacks run.
PROMPT_COMMAND=(__te2_directory_prompt "${PROMPT_COMMAND[@]}")
