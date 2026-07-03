package migrations

import (
	"context"
	"fmt"

	"github.com/Notifuse/notifuse/config"
	"github.com/Notifuse/notifuse/internal/domain"
)

// V35Migration repairs automation "add to list" nodes that stored the invalid
// status value 'subscribed' instead of the canonical 'active'.
//
// The v26 migration performed the same repair, but the console kept emitting
// 'subscribed' for new/edited add_to_list nodes afterwards, so automations built
// since then reintroduced the invalid value. This migration re-runs the value
// repair (paired with the console fix that now stores 'active') and recomputes
// automation stats so dashboards reflect the corrected data.
//
// This migration:
//  1. Updates contact_lists records with status='subscribed' -> 'active'
//  2. Updates automation nodes with status='subscribed' in their config -> 'active'
//  3. Updates contact_timeline changes JSON containing 'subscribed' -> 'active'
//  4. Recomputes automation stats from actual contact_automations data
type V35Migration struct{}

func (m *V35Migration) GetMajorVersion() float64 {
	return 35.0
}

func (m *V35Migration) HasSystemUpdate() bool {
	return false
}

func (m *V35Migration) HasWorkspaceUpdate() bool {
	return true
}

func (m *V35Migration) ShouldRestartServer() bool {
	return false
}

func (m *V35Migration) UpdateSystem(ctx context.Context, cfg *config.Config, db DBExecutor) error {
	return nil
}

func (m *V35Migration) UpdateWorkspace(ctx context.Context, cfg *config.Config, workspace *domain.Workspace, db DBExecutor) error {
	// Step 1: Fix contact_lists with invalid 'subscribed' status
	_, err := db.ExecContext(ctx, `
		UPDATE contact_lists
		SET status = 'active', updated_at = NOW()
		WHERE status = 'subscribed'
	`)
	if err != nil {
		return fmt.Errorf("failed to update contact_lists status: %w", err)
	}

	// Step 2: Fix automation nodes with 'subscribed' status in config
	// Only updates automations that have add_to_list nodes with subscribed status
	_, err = db.ExecContext(ctx, `
		UPDATE automations
		SET nodes = (
			SELECT COALESCE(jsonb_agg(
				CASE
					WHEN node->>'type' = 'add_to_list' AND node->'config'->>'status' = 'subscribed'
					THEN jsonb_set(node, '{config,status}', '"active"')
					ELSE node
				END
			), '[]'::jsonb)
			FROM jsonb_array_elements(nodes) AS node
		),
		updated_at = NOW()
		-- Guard on jsonb_typeof = 'array': a nil Nodes slice is marshalled to the
		-- JSON scalar 'null' (not SQL NULL and not '[]'), and jsonb_array_elements
		-- raises "cannot extract elements from a scalar" on it. This predicate also
		-- excludes SQL NULL, so the previous "nodes IS NOT NULL" check is unneeded.
		WHERE jsonb_typeof(nodes) = 'array'
		AND EXISTS (
			SELECT 1 FROM jsonb_array_elements(nodes) AS node
			WHERE node->>'type' = 'add_to_list'
			AND node->'config'->>'status' = 'subscribed'
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to update automation nodes: %w", err)
	}

	// Step 3: Fix contact_timeline entries with 'subscribed' in changes JSON
	_, err = db.ExecContext(ctx, `
		UPDATE contact_timeline
		SET changes = (
			CASE
				WHEN changes->'status'->>'old' = 'subscribed' AND changes->'status'->>'new' = 'subscribed'
				THEN jsonb_set(jsonb_set(changes, '{status,old}', '"active"'), '{status,new}', '"active"')
				WHEN changes->'status'->>'old' = 'subscribed'
				THEN jsonb_set(changes, '{status,old}', '"active"')
				WHEN changes->'status'->>'new' = 'subscribed'
				THEN jsonb_set(changes, '{status,new}', '"active"')
				ELSE changes
			END
		)
		WHERE entity_type = 'contact_list'
		AND (changes->'status'->>'old' = 'subscribed' OR changes->'status'->>'new' = 'subscribed')
	`)
	if err != nil {
		return fmt.Errorf("failed to update contact_timeline changes: %w", err)
	}

	// Step 4: Recompute automation stats from actual contact_automations data
	_, err = db.ExecContext(ctx, `
		UPDATE automations a
		SET stats = COALESCE((
			SELECT jsonb_build_object(
				'enrolled', COUNT(*),
				'completed', COUNT(*) FILTER (WHERE ca.status = 'completed'),
				'exited', COUNT(*) FILTER (WHERE ca.status = 'exited'),
				'failed', COUNT(*) FILTER (WHERE ca.status = 'failed')
			)
			FROM contact_automations ca
			WHERE ca.automation_id = a.id
		), '{"enrolled":0,"completed":0,"exited":0,"failed":0}'::jsonb),
		updated_at = NOW()
		WHERE deleted_at IS NULL
	`)
	if err != nil {
		return fmt.Errorf("failed to recompute automation stats: %w", err)
	}

	return nil
}

func init() {
	Register(&V35Migration{})
}
