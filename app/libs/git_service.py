"""
Git Service with Progress Reporting

Provides GitPython-based push/pull/clone operations with structured progress callbacks,
integrated with the Job Registry for async execution and progress tracking.

All other git operations (status, diff, log, stage, etc.) remain CLI-based via git_helper.py.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from git import Repo, RemoteProgress
from git.exc import GitCommandError, InvalidGitRepositoryError

from app.libs.jobs import register_job_handler, JobContext

logger = logging.getLogger(__name__)


class CallbackProgress(RemoteProgress):
    """
    GitPython progress handler that forwards structured events to a callback.
    
    Progress events include:
    - phase: "counting", "compressing", "writing", "receiving", "resolving", etc.
    - cur: current count
    - max: total count (may be None)
    - pct: percentage (0-100)
    - message: optional status message from git
    """
    
    # Map GitPython op_code stages to human-readable phase names
    STAGE_NAMES = {
        RemoteProgress.COUNTING: "counting",
        RemoteProgress.COMPRESSING: "compressing", 
        RemoteProgress.WRITING: "writing",
        RemoteProgress.RECEIVING: "receiving",
        RemoteProgress.RESOLVING: "resolving",
        RemoteProgress.FINDING_SOURCES: "finding_sources",
        RemoteProgress.CHECKING_OUT: "checking_out",
    }
    
    def __init__(self, callback: Callable[[Dict[str, Any]], None]):
        super().__init__()
        self.callback = callback
        self._last_pct = -1
    
    def update(self, op_code: int, cur_count: int, max_count: Optional[int] = None, message: str = ""):
        # Extract the stage from op_code
        stage = op_code & RemoteProgress.STAGE_MASK
        phase = self.STAGE_NAMES.get(stage, "working")
        
        # Calculate percentage
        pct = 0
        if max_count and max_count > 0:
            pct = int(cur_count * 100 / max_count)
        
        # Only emit if percentage changed (reduces noise)
        if pct != self._last_pct or message:
            self._last_pct = pct
            try:
                self.callback({
                    "phase": phase,
                    "cur": cur_count,
                    "max": max_count,
                    "pct": pct,
                    "message": message or "",
                })
            except Exception as e:
                # Don't let callback errors kill the git operation
                logger.warning(f"[CallbackProgress] Callback error (ignored): {e}")


def git_push_with_progress(
    repo_path: str,
    on_event: Callable[[Dict[str, Any]], None],
    remote: str = "origin",
    branch: Optional[str] = None,
    force: bool = False,
) -> Dict[str, Any]:
    """
    Execute git push with progress reporting.
    
    Args:
        repo_path: Path to the git repository
        on_event: Callback for progress events
        remote: Remote name (default: "origin")
        branch: Branch to push (default: current branch)
        force: Force push (default: False)
    
    Returns:
        Dict with success status and any error message
    """
    try:
        repo = Repo(repo_path)
        origin = repo.remote(remote)
        progress = CallbackProgress(on_event)
        
        # Determine refspec
        refspec = None
        if branch:
            refspec = f"{branch}:{branch}"
        
        # Execute push
        push_kwargs = {"progress": progress}
        if force:
            push_kwargs["force"] = True
        
        if refspec:
            result = origin.push(refspec, **push_kwargs)
        else:
            result = origin.push(**push_kwargs)
        
        # Check for errors in push info
        errors = []
        for info in result:
            if info.flags & info.ERROR:
                errors.append(info.summary)
        
        if errors:
            on_event({"error": "; ".join(errors)})
            return {"success": False, "error": "; ".join(errors)}
        
        on_event({"done": True, "pct": 100})
        return {"success": True}
        
    except InvalidGitRepositoryError:
        error = f"Not a git repository: {repo_path}"
        on_event({"error": error})
        return {"success": False, "error": error}
    except GitCommandError as e:
        error = str(e.stderr or e.stdout or str(e))
        on_event({"error": error})
        return {"success": False, "error": error}
    except Exception as e:
        error = str(e)
        on_event({"error": error})
        return {"success": False, "error": error}


def git_pull_with_progress(
    repo_path: str,
    on_event: Callable[[Dict[str, Any]], None],
    remote: str = "origin",
    branch: Optional[str] = None,
    rebase: bool = False,
) -> Dict[str, Any]:
    """
    Execute git pull with progress reporting.
    
    Args:
        repo_path: Path to the git repository
        on_event: Callback for progress events
        remote: Remote name (default: "origin")
        branch: Branch to pull (default: current branch)
        rebase: Use rebase instead of merge (default: False)
    
    Returns:
        Dict with success status and any error message
    """
    logger.info(f"[GIT_PULL] Starting pull: {repo_path} from {remote}")
    try:
        repo = Repo(repo_path)
        logger.debug(f"[GIT_PULL] Repo opened: {repo.working_dir}")
        
        origin = repo.remote(remote)
        logger.debug(f"[GIT_PULL] Remote: {origin.name} -> {list(origin.urls)}")
        
        progress = CallbackProgress(on_event)
        
        # Execute pull
        pull_kwargs = {"progress": progress}
        if rebase:
            pull_kwargs["rebase"] = True
            logger.debug(f"[GIT_PULL] Using rebase")
        
        if branch:
            logger.info(f"[GIT_PULL] Pulling branch: {branch}")
            result = origin.pull(branch, **pull_kwargs)
        else:
            logger.info(f"[GIT_PULL] Pulling default branch")
            result = origin.pull(**pull_kwargs)
        
        logger.info(f"[GIT_PULL] Pull completed")
        on_event({"done": True, "pct": 100})
        return {"success": True}
        
    except InvalidGitRepositoryError:
        error = f"Not a git repository: {repo_path}"
        logger.error(f"[GIT_PULL] {error}")
        on_event({"error": error})
        return {"success": False, "error": error}
    except GitCommandError as e:
        error = str(e.stderr or e.stdout or str(e))
        logger.error(f"[GIT_PULL] GitCommandError: {error}")
        on_event({"error": error})
        return {"success": False, "error": error}
    except Exception as e:
        error = str(e)
        logger.exception(f"[GIT_PULL] Exception: {error}")
        on_event({"error": error})
        return {"success": False, "error": error}


def git_clone_with_progress(
    url: str,
    target_path: str,
    on_event: Callable[[Dict[str, Any]], None],
    branch: Optional[str] = None,
    depth: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Execute git clone with progress reporting.
    
    Args:
        url: Repository URL to clone
        target_path: Destination path
        on_event: Callback for progress events
        branch: Specific branch to clone (default: default branch)
        depth: Shallow clone depth (default: full clone)
    
    Returns:
        Dict with success status, cloned path, and any error message
    """
    logger.info(f"[GIT_CLONE] Starting clone: {url} -> {target_path}")
    try:
        target = Path(target_path).expanduser().resolve()
        logger.debug(f"[GIT_CLONE] Resolved target: {target}")
        
        # Ensure parent exists
        target.parent.mkdir(parents=True, exist_ok=True)
        
        # Check if target exists and is not empty
        if target.exists() and any(target.iterdir()):
            error = f"Target directory '{target}' already exists and is not empty"
            logger.warning(f"[GIT_CLONE] {error}")
            on_event({"error": error})
            return {"success": False, "error": error}
        
        progress = CallbackProgress(on_event)
        
        # Build clone kwargs
        clone_kwargs = {"progress": progress}
        if branch:
            clone_kwargs["branch"] = branch
        if depth:
            clone_kwargs["depth"] = depth
        
        # Execute clone
        logger.info(f"[GIT_CLONE] Calling Repo.clone_from...")
        repo = Repo.clone_from(url, str(target), **clone_kwargs)
        logger.info(f"[GIT_CLONE] Clone completed: {repo.working_dir}")
        
        on_event({"done": True, "pct": 100})
        return {"success": True, "path": str(target)}
        
    except GitCommandError as e:
        error = str(e.stderr or e.stdout or str(e))
        logger.error(f"[GIT_CLONE] GitCommandError: {error}")
        on_event({"error": error})
        return {"success": False, "error": error}
    except Exception as e:
        error = str(e)
        logger.exception(f"[GIT_CLONE] Exception: {error}")
        on_event({"error": error})
        return {"success": False, "error": error}


# ---------------------------------------------------------------------------
# Job Handlers - Integrate with Job Registry
# ---------------------------------------------------------------------------


@register_job_handler("git_push")
def job_git_push(ctx: JobContext, params: Dict[str, Any]) -> None:
    """
    Job handler for git push with progress.
    
    Params:
        repo_path: Path to repository (required)
        remote: Remote name (default: "origin")
        branch: Branch to push (optional)
        force: Force push (default: False)
    """
    repo_path = params.get("repo_path")
    if not repo_path:
        raise ValueError("repo_path is required")
    
    remote = params.get("remote", "origin")
    branch = params.get("branch")
    force = params.get("force", False)
    
    ctx.set_message(f"Pushing to {remote}...")
    ctx.set_progress(completed=0, total=100, detail="Starting push")
    
    def on_event(ev: Dict[str, Any]):
        # Note: Don't call ctx.check_cancelled() here - it would kill the push mid-operation
        
        if "error" in ev:
            return  # Let git_push_with_progress return the error
        
        if ev.get("done"):
            return
        
        pct = ev.get("pct", 0)
        phase = ev.get("phase", "working")
        message = ev.get("message", "")
        
        detail = f"{phase}"
        if message:
            detail = f"{phase}: {message}"
        
        ctx.set_progress(completed=pct, total=100, detail=detail)
        ctx.set_message(f"Pushing: {pct}% ({phase})")
    
    result = git_push_with_progress(
        repo_path=repo_path,
        on_event=on_event,
        remote=remote,
        branch=branch,
        force=force,
    )
    
    if not result.get("success"):
        raise RuntimeError(result.get("error", "Push failed"))
    
    ctx.finish(
        message=f"Pushed to {remote}" + (f"/{branch}" if branch else ""),
        result={"repo_path": repo_path, "remote": remote, "branch": branch}
    )


@register_job_handler("git_pull")
def job_git_pull(ctx: JobContext, params: Dict[str, Any]) -> None:
    """
    Job handler for git pull with progress.
    
    Params:
        repo_path: Path to repository (required)
        remote: Remote name (default: "origin")
        branch: Branch to pull (optional)
        rebase: Use rebase (default: False)
    """
    repo_path = params.get("repo_path")
    
    logger.info(f"[JOB_GIT_PULL] Starting job: repo={repo_path}")
    
    if not repo_path:
        raise ValueError("repo_path is required")
    
    remote = params.get("remote", "origin")
    branch = params.get("branch")
    rebase = params.get("rebase", False)
    
    ctx.set_message(f"Pulling from {remote}...")
    ctx.set_progress(completed=0, total=100, detail="Starting pull")
    
    def on_event(ev: Dict[str, Any]):
        logger.debug(f"[JOB_GIT_PULL] Event: {ev}")
        # Note: Don't call ctx.check_cancelled() here - it would kill the pull mid-operation
        
        if "error" in ev:
            logger.error(f"[JOB_GIT_PULL] Error event: {ev['error']}")
            return  # Let git_pull_with_progress return the error
        
        if ev.get("done"):
            logger.info(f"[JOB_GIT_PULL] Done event received")
            return
        
        pct = ev.get("pct", 0)
        phase = ev.get("phase", "working")
        message = ev.get("message", "")
        
        detail = f"{phase}"
        if message:
            detail = f"{phase}: {message}"
        
        ctx.set_progress(completed=pct, total=100, detail=detail)
        ctx.set_message(f"Pulling: {pct}% ({phase})")
    
    result = git_pull_with_progress(
        repo_path=repo_path,
        on_event=on_event,
        remote=remote,
        branch=branch,
        rebase=rebase,
    )
    
    logger.info(f"[JOB_GIT_PULL] Result: {result}")
    
    if not result.get("success"):
        raise RuntimeError(result.get("error", "Pull failed"))
    
    ctx.finish(
        message=f"Pulled from {remote}" + (f"/{branch}" if branch else ""),
        result={"repo_path": repo_path, "remote": remote, "branch": branch}
    )


@register_job_handler("git_clone")
def job_git_clone(ctx: JobContext, params: Dict[str, Any]) -> None:
    """
    Job handler for git clone with progress.
    
    Params:
        url: Repository URL (required)
        target_path: Destination path (required)
        branch: Specific branch to clone (optional)
        depth: Shallow clone depth (optional)
    """
    url = params.get("url")
    target_path = params.get("target_path")
    
    logger.info(f"[JOB_GIT_CLONE] Starting job: url={url}, target={target_path}")
    
    if not url:
        raise ValueError("url is required")
    if not target_path:
        raise ValueError("target_path is required")
    
    branch = params.get("branch")
    depth = params.get("depth")
    
    # Extract repo name for display
    repo_name = url.rstrip("/").split("/")[-1]
    if repo_name.endswith(".git"):
        repo_name = repo_name[:-4]
    
    ctx.set_message(f"Cloning {repo_name}...")
    ctx.set_progress(completed=0, total=100, detail="Starting clone")
    
    def on_event(ev: Dict[str, Any]):
        logger.debug(f"[JOB_GIT_CLONE] Event: {ev}")
        # Note: Don't call ctx.check_cancelled() here - it would kill the clone mid-operation
        # The clone should complete or fail on its own; cancellation is checked after
        
        if "error" in ev:
            logger.error(f"[JOB_GIT_CLONE] Error event: {ev['error']}")
            # Don't raise here - let git_clone_with_progress return the error
            return
        
        if ev.get("done"):
            logger.info(f"[JOB_GIT_CLONE] Done event received")
            return
        
        pct = ev.get("pct", 0)
        phase = ev.get("phase", "working")
        message = ev.get("message", "")
        
        detail = f"{phase}"
        if message:
            detail = f"{phase}: {message}"
        
        ctx.set_progress(completed=pct, total=100, detail=detail)
        ctx.set_message(f"Cloning {repo_name}: {pct}% ({phase})")
    
    result = git_clone_with_progress(
        url=url,
        target_path=target_path,
        on_event=on_event,
        branch=branch,
        depth=depth,
    )
    
    logger.info(f"[JOB_GIT_CLONE] Result: {result}")
    
    if not result.get("success"):
        raise RuntimeError(result.get("error", "Clone failed"))
    
    ctx.finish(
        message=f"Cloned {repo_name}",
        result={"url": url, "path": result.get("path"), "branch": branch}
    )
