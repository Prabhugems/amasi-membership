// Tailwind Plus block — Application UI → Overlays → Drawers
// "Wide create project form example"
// Saved verbatim per AGENTS.md §1 — reference only, NOT imported into production.
// Borrowed visual language: right-anchored panel shell, sticky header (title +
// description + close X), scrollable body, sticky footer with Cancel + primary
// action and a top border. Adapted in
// src/components/admin/edit-application-fields-dialog.tsx — see AGENTS.md §2
// for the substitutions (Headless UI → Radix Dialog, Heroicons → lucide-react,
// hardcoded zinc/indigo → CSS variables).
'use client'

import { useState } from 'react'
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { LinkIcon, PlusIcon, QuestionMarkCircleIcon } from '@heroicons/react/20/solid'

const team = [
  {
    name: 'Tom Cook',
    email: 'tom.cook@example.com',
    href: '#',
    imageUrl:
      'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80',
  },
  {
    name: 'Whitney Francis',
    email: 'whitney.francis@example.com',
    href: '#',
    imageUrl:
      'https://images.unsplash.com/photo-1517365830460-955ce3ccd263?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80',
  },
  {
    name: 'Leonard Krasner',
    email: 'leonard.krasner@example.com',
    href: '#',
    imageUrl:
      'https://images.unsplash.com/photo-1519345182560-3f2917c472ef?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80',
  },
  {
    name: 'Floyd Miles',
    email: 'floyd.miles@example.com',
    href: '#',
    imageUrl:
      'https://images.unsplash.com/photo-1463453091185-61582044d556?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80',
  },
  {
    name: 'Emily Selman',
    email: 'emily.selman@example.com',
    href: '#',
    imageUrl:
      'https://images.unsplash.com/photo-1502685104226-ee32379fefbe?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80',
  },
]

export default function Example() {
  const [open, setOpen] = useState(true)

  return (
    <div>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-white/10 px-2.5 py-1.5 text-sm font-semibold text-white inset-ring inset-ring-white/5 hover:bg-white/20"
      >
        Open drawer
      </button>
      <Dialog open={open} onClose={setOpen} className="relative z-10">
        <div className="fixed inset-0" />

        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10 sm:pl-16">
              <DialogPanel
                transition
                className="pointer-events-auto w-screen max-w-2xl transform transition duration-500 ease-in-out data-closed:translate-x-full sm:duration-700"
              >
                <form className="relative flex h-full flex-col overflow-y-auto bg-gray-800 shadow-xl after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-white/10">
                  <div className="flex-1">
                    {/* Header */}
                    <div className="bg-gray-800/50 px-4 py-6 sm:px-6">
                      <div className="flex items-start justify-between space-x-3">
                        <div className="space-y-1">
                          <DialogTitle className="text-base font-semibold text-white">New project</DialogTitle>
                          <p className="text-sm text-gray-400">
                            Get started by filling in the information below to create your new project.
                          </p>
                        </div>
                        <div className="flex h-7 items-center">
                          <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="relative rounded-md text-gray-400 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                          >
                            <span className="absolute -inset-2.5" />
                            <span className="sr-only">Close panel</span>
                            <XMarkIcon aria-hidden="true" className="size-6" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Divider container */}
                    <div className="space-y-6 py-6 sm:space-y-0 sm:divide-y sm:divide-white/10 sm:py-0">
                      {/* Project name */}
                      <div className="space-y-2 px-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:space-y-0 sm:px-6 sm:py-5">
                        <div>
                          <label htmlFor="project-name" className="block text-sm/6 font-medium text-white sm:mt-1.5">
                            Project name
                          </label>
                        </div>
                        <div className="sm:col-span-2">
                          <input
                            id="project-name"
                            name="project-name"
                            type="text"
                            className="block w-full rounded-md bg-white/5 px-3 py-1.5 text-base text-white outline-1 -outline-offset-1 outline-white/10 placeholder:text-gray-500 focus:outline-indigo-500 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600 sm:text-sm/6"
                          />
                        </div>
                      </div>

                      {/* Project description */}
                      <div className="space-y-2 px-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:space-y-0 sm:px-6 sm:py-5">
                        <div>
                          <label
                            htmlFor="project-description"
                            className="block text-sm/6 font-medium text-white sm:mt-1.5"
                          >
                            Description
                          </label>
                        </div>
                        <div className="sm:col-span-2">
                          <textarea
                            id="project-description"
                            name="project-description"
                            rows={3}
                            className="block w-full rounded-md bg-white/5 px-3 py-1.5 text-base text-white outline-1 -outline-offset-1 outline-white/10 placeholder:text-gray-500 focus:outline-indigo-500 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600 sm:text-sm/6"
                            defaultValue={''}
                          />
                        </div>
                      </div>

                      {/* Team members */}
                      <div className="space-y-2 px-4 sm:grid sm:grid-cols-3 sm:items-center sm:gap-4 sm:space-y-0 sm:px-6 sm:py-5">
                        <div>
                          <h3 className="text-sm/6 font-medium text-white">Team Members</h3>
                        </div>
                        <div className="sm:col-span-2">
                          <div className="flex space-x-2">
                            {team.map((person) => (
                              <a
                                key={person.email}
                                href={person.href}
                                className="shrink-0 rounded-full hover:opacity-75"
                              >
                                <img
                                  alt={person.name}
                                  src={person.imageUrl}
                                  className="inline-block size-8 rounded-full bg-gray-800 outline -outline-offset-1 outline-white/10"
                                />
                              </a>
                            ))}

                            <button
                              type="button"
                              className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-white/20 bg-gray-800 text-gray-300 hover:border-white/30 hover:text-gray-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                            >
                              <span className="absolute -inset-2" />
                              <span className="sr-only">Add team member</span>
                              <PlusIcon aria-hidden="true" className="size-5" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Privacy */}
                      <fieldset className="space-y-2 px-4 sm:grid sm:grid-cols-3 sm:items-start sm:gap-4 sm:space-y-0 sm:px-6 sm:py-5">
                        <legend className="sr-only">Privacy</legend>
                        <div aria-hidden="true" className="text-sm/6 font-medium text-white">
                          Privacy
                        </div>
                        <div className="space-y-5 sm:col-span-2">
                          <div className="space-y-5 sm:mt-0">
                            <div className="relative flex items-start">
                              <div className="absolute flex h-6 items-center">
                                <input
                                  defaultValue="public"
                                  defaultChecked
                                  id="privacy-public"
                                  name="privacy"
                                  type="radio"
                                  aria-describedby="privacy-public-description"
                                  className="relative size-4 appearance-none rounded-full border border-white/20 bg-black/10 before:absolute before:inset-1 before:rounded-full before:bg-white not-checked:before:hidden checked:border-indigo-500 checked:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:border-white/10 disabled:bg-gray-800 disabled:before:bg-white/20 forced-colors:appearance-auto forced-colors:before:hidden"
                                />
                              </div>
                              <div className="pl-7 text-sm/6">
                                <label htmlFor="privacy-public" className="font-medium text-white">
                                  Public access
                                </label>
                                <p id="privacy-public-description" className="text-gray-400">
                                  Everyone with the link will see this project.
                                </p>
                              </div>
                            </div>
                            <div className="relative flex items-start">
                              <div className="absolute flex h-6 items-center">
                                <input
                                  defaultValue="private-to-project"
                                  id="privacy-private-to-project"
                                  name="privacy"
                                  type="radio"
                                  aria-describedby="privacy-private-to-project-description"
                                  className="relative size-4 appearance-none rounded-full border border-white/20 bg-black/10 before:absolute before:inset-1 before:rounded-full before:bg-white not-checked:before:hidden checked:border-indigo-500 checked:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:border-white/10 disabled:bg-gray-800 disabled:before:bg-white/20 forced-colors:appearance-auto forced-colors:before:hidden"
                                />
                              </div>
                              <div className="pl-7 text-sm/6">
                                <label htmlFor="privacy-private-to-project" className="font-medium text-white">
                                  Private to project members
                                </label>
                                <p id="privacy-private-to-project-description" className="text-gray-400">
                                  Only members of this project would be able to access.
                                </p>
                              </div>
                            </div>
                            <div className="relative flex items-start">
                              <div className="absolute flex h-6 items-center">
                                <input
                                  defaultValue="private"
                                  id="privacy-private"
                                  name="privacy"
                                  type="radio"
                                  aria-describedby="privacy-private-to-project-description"
                                  className="relative size-4 appearance-none rounded-full border border-white/20 bg-black/10 before:absolute before:inset-1 before:rounded-full before:bg-white not-checked:before:hidden checked:border-indigo-500 checked:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:border-white/10 disabled:bg-gray-800 disabled:before:bg-white/20 forced-colors:appearance-auto forced-colors:before:hidden"
                                />
                              </div>
                              <div className="pl-7 text-sm/6">
                                <label htmlFor="privacy-private" className="font-medium text-white">
                                  Private to you
                                </label>
                                <p id="privacy-private-description" className="text-gray-400">
                                  You are the only one able to access this project.
                                </p>
                              </div>
                            </div>
                          </div>
                          <hr className="border-white/10" />
                          <div className="flex flex-col items-start space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
                            <div>
                              <a
                                href="#"
                                className="group flex items-center space-x-2.5 text-sm font-medium text-indigo-400 hover:text-indigo-300"
                              >
                                <LinkIcon
                                  aria-hidden="true"
                                  className="size-5 text-indigo-400 group-hover:text-indigo-300"
                                />
                                <span>Copy link</span>
                              </a>
                            </div>
                            <div>
                              <a
                                href="#"
                                className="group flex items-center space-x-2.5 text-sm text-gray-500 hover:text-gray-300"
                              >
                                <QuestionMarkCircleIcon
                                  aria-hidden="true"
                                  className="size-5 text-gray-600 group-hover:text-gray-400"
                                />
                                <span>Learn more about sharing</span>
                              </a>
                            </div>
                          </div>
                        </div>
                      </fieldset>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="shrink-0 border-t border-white/10 px-4 py-5 sm:px-6">
                    <div className="flex justify-end space-x-3">
                      <button
                        type="button"
                        onClick={() => setOpen(false)}
                        className="rounded-md bg-white/10 px-3 py-2 text-sm font-semibold text-gray-100 inset-ring inset-ring-white/5 hover:bg-white/20"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="inline-flex justify-center rounded-md bg-indigo-500 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                      >
                        Create
                      </button>
                    </div>
                  </div>
                </form>
              </DialogPanel>
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
