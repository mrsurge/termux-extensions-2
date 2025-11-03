"""Agent drawer placeholder."""

from nicegui import ui

from ...core.module import Module


class AgentDrawerModule(Module):
    @property
    def key(self) -> str:
        return "agent_drawer"

    @property
    def label(self) -> str:
        return "Agents"

    def render(self, container: ui.element) -> None:
        with container:
            with ui.card().classes("flex h-full flex-col bg-slate-900/60"):
                ui.label("Agent Drawer").classes("text-sm text-slate-200")
                ui.separator()
                ui.label("(Agent tooling coming soon)").classes("text-xs text-slate-400")
