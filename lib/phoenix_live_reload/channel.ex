#
# Patch this file to enable HMR; Hot Module Reloading for other asset types
#

defmodule Phoenix.LiveReloader.Channel do
  @moduledoc """
  Phoenix's live-reload channel.
  """
  use Phoenix.Channel
  require Logger

  @impl true
  def join("phoenix:live_reload", _msg, socket) do
    {:ok, _} = Application.ensure_all_started(:phoenix_live_reload)
    patterns = socket.endpoint.config(:live_reload)[:patterns]
    root = Path.expand(socket.endpoint.config(:live_reload)[:root] || "")

    if Process.whereis(:phoenix_live_reload_file_monitor) do
      Logger.debug("Browser connected to live reload! Endpoint: " <> inspect(socket.endpoint))
      FileSystem.subscribe(:phoenix_live_reload_file_monitor)
      {:ok, socket |> assign(:patterns, patterns) |> assign(:root, root)}
    else
      {:error, %{message: "live reload backend not running"}}
    end
  end

  # HACK Backend tool for FileSystem (mac_listener or inotifywait) emits multiple events on a file modification.
  # So we are throttling those events before sending assets_change frame.
  @impl true
  def handle_info({:file_event, _pid, {path, _event}}, socket) do
    with {:stale, socket} <- check_last_modified_at(socket, path) do
      if matches_any_pattern?(path, socket.assigns[:patterns]) do
        asset_type = remove_leading_dot(Path.extname(path))
        Logger.debug("Live reload: #{Path.relative_to_cwd(path)}")
        path = String.trim_leading(path, socket.assigns[:root])
        push(socket, "assets_change", %{asset_type: asset_type, path: path})
      end

      {:noreply, socket}
    end
  end

  defp matches_any_pattern?(path, patterns) do
    path = to_string(path)

    Enum.any?(patterns, fn pattern ->
      String.match?(path, pattern) and !String.match?(path, ~r{(^|/)_build/})
    end)
  end

  defp remove_leading_dot("." <> rest), do: rest
  defp remove_leading_dot(rest), do: rest

  @become_stale_in 2
  defp check_last_modified_at(socket, path) do
    now = System.system_time(:second)
    last_modified_at = socket.assigns[:last_modified_at][path] || 0

    # Always save last_modified_at, even if already stale
    socket = save_last_modified_at(socket, path, now)

    if last_modified_at + @become_stale_in < now do
      {:stale, socket}
    else
      {:noreply, socket}
    end
  end

  defp save_last_modified_at(socket, path, now) do
    lma_map = Map.put(socket.assigns[:last_modified_at] || %{}, path, now)
    assign(socket, :last_modified_at, lma_map)
  end

  @impl true
  def terminate(_reason, socket) do
    Logger.debug("Browser disconnected from live reload. Endpoint: " <> inspect(socket.endpoint))
  end
end
