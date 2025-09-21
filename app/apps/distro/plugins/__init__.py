"""Container plugin registry for the Distro app."""

from .chroot import ChrootDistroPlugin

PLUGIN_REGISTRY = {
    'chroot-distro': ChrootDistroPlugin,
}


def get_plugin(container):
    plugin_type = container.get('type')
    cls = PLUGIN_REGISTRY.get(plugin_type)
    if not cls:
        raise ValueError(f"Unsupported container type: {plugin_type}")
    return cls(container)
